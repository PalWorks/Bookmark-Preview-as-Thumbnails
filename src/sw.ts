/// <reference types="chrome" />

import { captureManager } from './lib/capture';
import { thumbnailStorage } from './lib/thumbnail_storage';
import { storageIndex } from './lib/storage_index';
import { fsAccess } from './lib/fsaccess';
import { generateErrorImage } from './lib/error_generator';

// Service Worker for BookmarksThumbnails

// Listen for extension icon click
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({
        url: chrome.runtime.getURL('index.html')
    });
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CAPTURE_THUMBNAIL') {
        captureActiveTab()
            .then(sendResponse)
            .catch((err) => {
                console.error('Capture failed:', err);
                sendResponse({ error: (err as Error).message });
            });
        return true; // synchronous return true — holds channel open for async response
    }

    if (message.type === 'BATCH_CAPTURE') {
        const incognito = _sender.tab?.incognito ?? false;
        processBatchCapture(message.urls, incognito, message.useActiveTabCapture);
        sendResponse({ status: 'queued' });
        return false;
    }

    if (message.type === 'STOP_CAPTURE') {
        stopBatchCapture = true;
        sendResponse({ status: 'stopping' });
        return false;
    }

    if (message.type === 'PING') {
        sendResponse({ status: 'ok' });
        return false;
    }

    return false;
});

let isBatchCapturing = false;
let stopBatchCapture = false;

async function processBatchCapture(
    urls: string[],
    incognitoContext: boolean = false,
    useActiveTabCapture: boolean = false
) {
    if (isBatchCapturing) return;
    isBatchCapturing = true;
    stopBatchCapture = false;

    // Create a window to perform captures without disrupting the user
    let captureWindow: chrome.windows.Window | undefined;
    try {
        const createOptions: chrome.windows.CreateData = {
            focused: false,
            state: 'normal',
            width: 1024,
            height: 768,
            incognito: !!incognitoContext
        };
        captureWindow = await chrome.windows.create(createOptions);
        if (captureWindow?.id) {
            chrome.windows.update(captureWindow.id, { left: -10000, top: -10000 }).catch(() => {});
        }
    } catch (e) {
        console.error('Failed to create capture window', e);
        isBatchCapturing = false;
        return;
    }

    if (!captureWindow?.id) {
        isBatchCapturing = false;
        return;
    }

    // If using active tab capture, serialise (concurrency 1) to avoid focus conflicts
    const CONCURRENCY = useActiveTabCapture ? 1 : 3;
    const tabIds: number[] = [];

    const tabs = await chrome.tabs.query({ windowId: captureWindow.id });
    if (tabs.length > 0 && tabs[0].id) tabIds.push(tabs[0].id);

    for (let i = tabIds.length; i < CONCURRENCY; i++) {
        try {
            const tab = await chrome.tabs.create({ windowId: captureWindow.id, active: false });
            if (tab.id) tabIds.push(tab.id);
        } catch (e) {
            console.warn('Failed to create additional capture tab', e);
        }
    }

    if (tabIds.length === 0) {
        console.error('No tabs available for capture');
        await chrome.windows.remove(captureWindow.id);
        isBatchCapturing = false;
        return;
    }

    // Read captureDelay once for the entire batch (not per-URL)
    const stored = await chrome.storage.sync.get(['captureDelay']);
    const captureDelay = Math.max(100, Number(stored.captureDelay || 500));

    let currentIndex = 0;

    const captureSingleUrl = async (tabId: number, url: string) => {
        let navError: string | null = null;

        const errorListener = (details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
            if (details.tabId === tabId && details.frameId === 0) {
                navError = details.error;
            }
        };
        chrome.webNavigation.onErrorOccurred.addListener(errorListener);

        try {
            chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED', url }).catch(() => {});

            await chrome.tabs.update(tabId, { url, muted: true });

            // Wait for tab to finish loading
            await new Promise<void>((resolve) => {
                const listener = (tid: number, changeInfo: { status?: string }) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }, 30000);
            });

            chrome.webNavigation.onErrorOccurred.removeListener(errorListener);

            await new Promise(resolve => setTimeout(resolve, captureDelay));

            if (stopBatchCapture) return;

            if (navError) {
                const dataUrl = await generateErrorImage(navError, url);
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                await thumbnailStorage.putThumbnail({
                    id: url, url, mime: 'image/jpeg', blob,
                    updatedAt: Date.now(), width: 600, height: 400, sizeBytes: blob.size
                });
                await storageIndex.set({
                    id: url, url, title: 'Navigation Error', status: 'error', lastCaptureAt: Date.now()
                });
                chrome.runtime.sendMessage({ type: 'THUMBNAIL_UPDATED', url, id: url }).catch(() => {});
            } else {
                await captureTab(tabId, url, useActiveTabCapture);
            }
        } catch (rawError: unknown) {
            const errMsg = rawError instanceof Error ? rawError.message : 'Capture Failed';
            chrome.webNavigation.onErrorOccurred.removeListener(errorListener);
            console.error('Failed to capture', url, rawError);
            try {
                const dataUrl = await generateErrorImage(errMsg, url);
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                await thumbnailStorage.putThumbnail({
                    id: url, url, mime: 'image/jpeg', blob,
                    updatedAt: Date.now(), width: 600, height: 400, sizeBytes: blob.size
                });
                await storageIndex.set({
                    id: url, url, title: 'Capture Error', status: 'error', lastCaptureAt: Date.now()
                });
                chrome.runtime.sendMessage({ type: 'THUMBNAIL_UPDATED', url, id: url }).catch(() => {});
            } catch (e) {
                console.error('Failed to generate error fallback', e);
                chrome.runtime.sendMessage({ type: 'CAPTURE_FAILED', url, error: errMsg }).catch(() => {});
            }
        }
    };

    const worker = async (tabId: number) => {
        while (currentIndex < urls.length && !stopBatchCapture) {
            const url = urls[currentIndex++];
            await captureSingleUrl(tabId, url);
        }
    };

    try {
        await Promise.all(tabIds.map(id => worker(id)));
    } finally {
        try {
            if (captureWindow?.id) await chrome.windows.remove(captureWindow.id);
        } catch (_) { /* window already closed */ }
        isBatchCapturing = false;
        stopBatchCapture = false;
        chrome.runtime.sendMessage({ type: 'BATCH_STOPPED' }).catch(() => {});
    }
}

// Auto-capture when a bookmark is created
chrome.bookmarks.onCreated.addListener(async (_id, bookmark) => {
    if (bookmark.url) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (activeTab?.id && activeTab.url === bookmark.url) {
            try {
                await captureTab(activeTab.id, bookmark.url);
            } catch (err) {
                console.error('Auto-capture failed:', err);
            }
        }
    }
});

// ─── Capture functions ────────────────────────────────────────────────────────

// Shared logic: capture a tab and persist the result under the given id
async function persistCapture(
    tabId: number,
    id: string,
    useActiveTabCapture: boolean
): Promise<{ success: boolean; id: string; dataUrl: string }> {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) throw new Error('Tab has no URL');

    const dataUrl = await captureManager.capture(tabId, { useActiveTabCapture });
    const result = await captureManager.resizeAndCompress(dataUrl, 600, 0.8);

    let status: 'saved_indexeddb' | 'saved_disk' = 'saved_indexeddb';
    let savedFilename: string | undefined;

    try {
        const hasHandle = await fsAccess.restoreHandle();
        if (hasHandle) {
            const filename = `${tab.title?.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled'}_${Date.now()}.webp`;
            await fsAccess.writeFile(filename, result.blob);
            status = 'saved_disk';
            savedFilename = filename;
        }
    } catch (fsError) {
        console.warn('Failed to save to disk:', fsError);
    }

    await thumbnailStorage.putThumbnail({
        id,
        url: tab.url,
        mime: 'image/webp',
        blob: result.blob,
        updatedAt: Date.now(),
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
        filename: savedFilename,
    });

    await storageIndex.set({
        id,
        url: tab.url,
        title: tab.title || 'Untitled',
        status,
        lastCaptureAt: Date.now(),
    });

    chrome.runtime.sendMessage({ type: 'THUMBNAIL_UPDATED', url: id, id }).catch(() => {});

    return { success: true, id, dataUrl: result.dataUrl };
}

// Capture the currently active tab (CAPTURE_THUMBNAIL message path)
async function captureActiveTab(): Promise<{ success: boolean; id: string; dataUrl: string }> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) throw new Error('No active tab found');
    if (!tab.url) throw new Error('Tab has no URL');
    return persistCapture(tab.id, tab.url, false);
}

// Capture a specific tab with an explicit target URL (batch capture + auto-capture path)
async function captureTab(
    tabId: number,
    overrideUrl: string,
    useActiveTabCapture: boolean = false
): Promise<{ success: boolean; id: string; dataUrl: string }> {
    return persistCapture(tabId, overrideUrl, useActiveTabCapture);
}

// ─── Installation & migration ─────────────────────────────────────────────────

// Migrate old storage keys (raw URL keys) to the new meta_ prefix scheme
async function migrateStorageIndexKeys(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    const toMigrate = Object.entries(all).filter(
        ([k]) => !k.startsWith('thumb_') && !k.startsWith('meta_') && k !== 'hasSeenWelcome'
    );
    if (toMigrate.length === 0) return;
    const toSet: Record<string, unknown> = {};
    const toRemove: string[] = [];
    for (const [k, v] of toMigrate) {
        toSet[`meta_${k}`] = v;
        toRemove.push(k);
    }
    await chrome.storage.local.set(toSet);
    await chrome.storage.local.remove(toRemove);
    console.log(`[StorageIndex] Migrated ${toMigrate.length} metadata key(s) to meta_ prefix.`);
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    }
    if (details.reason === 'update') {
        migrateStorageIndexKeys().catch(err => console.error('[StorageIndex] Migration failed:', err));
    }
    chrome.runtime.setUninstallURL('https://palworks.github.io/Bookmark-Preview-as-Thumbnails/uninstall-feedback.html');
});
