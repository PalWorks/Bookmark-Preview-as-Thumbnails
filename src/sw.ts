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

    if (message.type === 'PING') {
        sendResponse({ status: 'ok' });
    }

    return true; // Keep channel open for async response
});

async function processBatchCapture(urls: string[]) {
    console.log('Starting batch capture for', urls.length, 'URLs');

    for (const url of urls) {
        try {
            // Create a tab but don't make it active (to minimize disruption)
            // Cast options to any to allow 'muted' property
            const tab = await chrome.tabs.create({ url, active: false, muted: true } as any) as chrome.tabs.Tab;

            if (!tab || !tab.id) continue;

            // Wait for tab to load
            await new Promise<void>((resolve) => {
                const listener = (tabId: number, changeInfo: any) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);

                // Timeout fallback (e.g. 15 seconds)
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }, 15000);
            });

            // Wait a bit more for rendering
            await new Promise(r => setTimeout(r, 2000));

            // Capture
            // Note: captureVisibleTab captures the *active* tab in the window.
            // If we opened the tab in the background (active: false), we might not be able to capture it 
            // unless we make it active momentarily or use a different window.
            // Chrome API limitation: captureVisibleTab requires the tab to be visible (active).
            // So we MUST make it active to capture.

            await chrome.tabs.update(tab.id, { active: true });
            // Wait for switch
            await new Promise(r => setTimeout(r, 500));

            await handleCapture();

            // Close tab
            await chrome.tabs.remove(tab.id);

        } catch (err) {
            console.error('Failed to capture', url, err);
        }
    }
    console.log('Batch capture complete');
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

async function handleCapture() {
    try {
        const dataUrl = await captureManager.captureVisibleTab(undefined); // undefined windowId means current window
        const result = await captureManager.resizeAndCompress(dataUrl, 600, 0.8); // 600px width

        // Get tab info to store metadata
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab || !tab.id || !tab.url) throw new Error('No active tab found');

        const id = tab.url; // Use URL as ID for simplicity, or generate UUID

        // Save to IndexedDB
        await db.putThumbnail({
            id,
            url: tab.url,
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

        return { success: true, id, dataUrl: result.dataUrl };
    } catch (error: unknown) {
        console.error('Capture error:', error);
        throw error;
    }
}
