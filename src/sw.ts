/// <reference types="chrome" />

// Service Worker for BookmarksThumbnails

chrome.runtime.onInstalled.addListener(() => {
    console.log('BookmarksThumbnails extension installed');
});

// Listen for extension icon click
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: 'index.html' });
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('Received message:', message);

    if (message.type === 'CAPTURE_THUMBNAIL') {
        handleCapture().then(sendResponse).catch((err) => {
            console.error('Capture failed:', err);
            sendResponse({ error: err.message });
        });
        return true;
    }

    if (message.type === 'BATCH_CAPTURE') {
        processBatchCapture(message.urls);
        return true;
    }

    if (message.type === 'STOP_CAPTURE') {
        stopBatchCapture = true;
        sendResponse({ status: 'stopping' });
        return true;
    }

    if (message.type === 'PING') {
        sendResponse({ status: 'ok' });
    }

    return true; // Keep channel open for async response
});

let isBatchCapturing = false;
let stopBatchCapture = false;

async function processBatchCapture(urls: string[]) {
    if (isBatchCapturing) {
        console.log('Batch capture already in progress');
        return;
    }
    isBatchCapturing = true;
    stopBatchCapture = false;
    console.log('Starting batch capture for', urls.length, 'URLs');

    // Create a window to perform captures without disrupting the user
    let captureWindow: chrome.windows.Window | undefined;
    try {
        // Check for incognito setting
        const settings = await chrome.storage.sync.get(['useIncognito']);
        const incognito = settings.useIncognito || false;

        // Create normal but unfocused window
        const createOptions: any = {
            focused: false,
            state: 'normal',
            width: 1024,
            height: 768,
            incognito: !!incognito
        };

        captureWindow = await chrome.windows.create(createOptions);

        // Move off-screen immediately
        if (captureWindow && captureWindow.id) {
            chrome.windows.update(captureWindow.id, { left: -10000, top: -10000 }).catch(() => { });
        }
    } catch (e) {
        console.error('Failed to create capture window', e);
        isBatchCapturing = false;
        return;
    }

    if (!captureWindow || !captureWindow.id) {
        isBatchCapturing = false;
        return;
    }

    // Get the initial tab from the capture window
    const tabs = await chrome.tabs.query({ windowId: captureWindow.id });
    if (tabs.length === 0 || !tabs[0].id) {
        console.error('No tab found in capture window');
        await chrome.windows.remove(captureWindow.id);
        isBatchCapturing = false;
        return;
    }
    const captureTabId = tabs[0].id;

    for (const url of urls) {
        if (stopBatchCapture) {
            console.log('Batch capture stopped by user');
            break;
        }

        try {
            chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED', url }).catch(() => { });

            // Navigate the existing tab to the new URL
            await chrome.tabs.update(captureTabId, { url, active: true, muted: true });

            // Wait for tab to load
            await new Promise<void>((resolve) => {
                const listener = (tabId: number, changeInfo: any) => {
                    if (tabId === captureTabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                // Timeout after 30s
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }, 30000);
            });

            // Wait for rendering (1s) - Optimized from 2s
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (stopBatchCapture) {
                break;
            }

            // Capture using unified method
            await handleCapture(captureTabId, url);

        } catch (error: any) {
            console.error('Failed to capture', url, error);
            // Notify UI of failure so it doesn't get stuck loading
            chrome.runtime.sendMessage({
                type: 'CAPTURE_FAILED',
                url,
                error: error.message
            }).catch(() => { });
        }
    }

    // Close the capture window
    if (captureWindow && captureWindow.id) {
        await chrome.windows.remove(captureWindow.id);
    }
    console.log('Batch capture complete');
    isBatchCapturing = false;
    stopBatchCapture = false;
}

// Auto-capture when a bookmark is created
chrome.bookmarks.onCreated.addListener(async (_id, bookmark) => {
    if (bookmark.url) {
        // Check if the active tab matches this URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];

        if (activeTab && activeTab.url === bookmark.url) {
            console.log('Bookmark created for active tab, capturing thumbnail...');
            try {
                await handleCapture();
            } catch (err) {
                console.error('Auto-capture failed:', err);
            }
        }
    }
});

import { captureManager } from './lib/capture';
import { db } from './lib/indexeddb';
import { storageIndex } from './lib/storage_index';
import { fsAccess } from './lib/fsaccess';

async function handleCapture(tabIdOrWindowId?: number, overrideUrl?: string) {
    try {
        let tabId: number;

        if (tabIdOrWindowId) {
            // Check if it's a tab ID or Window ID
            // Since we passed tab.id in processBatchCapture, we treat it as tabId if possible.
            // But handleCapture was originally designed for windowId (from active tab).
            // Let's try to determine.
            try {
                const tab = await chrome.tabs.get(tabIdOrWindowId);
                tabId = tab.id!;
            } catch {
                // Not a tab, assume window ID and get active tab
                const tabs = await chrome.tabs.query({ windowId: tabIdOrWindowId, active: true });
                if (!tabs[0]?.id) throw new Error('No active tab in window');
                tabId = tabs[0].id;
            }
        } else {
            // No ID provided, get active tab of current window
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tabs[0]?.id) throw new Error('No active tab found');
            tabId = tabs[0].id;
        }

        const tab = await chrome.tabs.get(tabId);
        if (!tab.url) throw new Error('Tab has no URL');

        // Use unified capture method
        const dataUrl = await captureManager.capture(tabId);
        const result = await captureManager.resizeAndCompress(dataUrl, 600, 0.8); // 600px width

        // Use overrideUrl as ID if provided, otherwise use tab.url
        // This ensures that if the page redirected, we still store/update the thumbnail for the original requested URL
        const id = overrideUrl || tab.url;

        // Save to IndexedDB
        await db.putThumbnail({
            id,
            url: tab.url, // Keep actual URL for reference
            mime: 'image/webp',
            blob: result.blob,
            updatedAt: Date.now(),
            width: result.width,
            height: result.height,
            sizeBytes: result.sizeBytes,
        });

        // Try to save to disk if directory handle is available
        let status: 'saved_indexeddb' | 'saved_disk' = 'saved_indexeddb';
        try {
            const hasHandle = await fsAccess.restoreHandle();
            if (hasHandle) {
                // Sanitize filename
                const filename = `${tab.title?.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled'}_${Date.now()}.webp`;
                await fsAccess.writeFile(filename, result.blob);
                status = 'saved_disk';
            }
        } catch (fsError) {
            console.warn('Failed to save to disk:', fsError);
            // Fallback to indexeddb status, which is already set
        }

        // Save metadata
        await storageIndex.set({
            id,
            url: tab.url,
            title: tab.title || 'Untitled',
            status,
            lastCaptureAt: Date.now(),
        });

        // Broadcast update using the ID (which matches the requested URL)
        chrome.runtime.sendMessage({
            type: 'THUMBNAIL_UPDATED',
            url: id,
            id
        }).catch(() => {
            // Ignore if no listeners (e.g. popup closed)
        });

        return { success: true, id, dataUrl: result.dataUrl };
    } catch (error: unknown) {
        console.error('Capture error:', error);
        throw error;
    }
}
