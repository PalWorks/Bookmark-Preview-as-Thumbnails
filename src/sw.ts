/// <reference types="chrome" />

import { captureManager } from './lib/capture';
import { thumbnailStorage } from './lib/thumbnail_storage';
import { storageIndex } from './lib/storage_index';
import { fsAccess } from './lib/fsaccess';
import { generateErrorImage } from './lib/error_generator';
import { checkAIAvailability, tagBookmark, invalidateAITemplate, searchBookmarks, friendlyError, isFatalAIError } from './lib/ai_tagger';
import { loadAISettings } from './lib/ai_settings_storage';

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
                const msg = err instanceof Error
                    ? err.message
                    : (typeof err === 'object' && err !== null && 'message' in err)
                        ? String((err as { message: unknown }).message)
                        : 'Capture Failed';
                sendResponse({ error: msg });
            });
        return true; // synchronous return true — holds channel open for async response
    }

    if (message.type === 'BATCH_CAPTURE') {
        // Reject re-entrant batches (e.g. rapid stop→start while the previous batch
        // is still tearing down). Responding 'busy' lets the popup release the URLs
        // it optimistically queued, instead of leaving them stuck forever.
        if (isBatchCapturing) {
            sendResponse({ status: 'busy' });
            return false;
        }
        const incognito = _sender.tab?.incognito ?? false;
        processBatchCapture(message.urls, incognito, message.useActiveTabCapture);
        sendResponse({ status: 'queued' });
        return false;
    }

    if (message.type === 'STOP_CAPTURE') {
        stopBatchCapture = true;
        // Abort in-flight captures so they unwind immediately instead of running
        // out their 5–10s internal timeouts before the worker loop notices the flag.
        batchController?.abort();
        sendResponse({ status: 'stopping' });
        return false;
    }

    if (message.type === 'PING') {
        sendResponse({ status: 'ok' });
        return false;
    }

    if (message.type === 'CHECK_AI_AVAILABILITY') {
        checkAIAvailability()
            .then(available => sendResponse({ available }))
            .catch(() => sendResponse({ available: 'unsupported' }));
        return true; // async response
    }

    if (message.type === 'AUTO_TAG') {
        if (isAutoTagging) {
            sendResponse({ status: 'busy' });
            return false;
        }
        processAutoTag(message.bookmarks as Array<{ url: string; title: string }>);
        sendResponse({ status: 'started' });
        return false;
    }

    if (message.type === 'STOP_TAG') {
        stopAutoTagFlag = true;
        // Abort the in-flight AI call so a hung/slow request unblocks immediately,
        // rather than waiting for the loop to reach its next flag check.
        autoTagController?.abort();
        sendResponse({ status: 'stopping' });
        return false;
    }

    if (message.type === 'GET_TAG_STATUS') {
        // Lets the popup restore the live progress/Stop indicator after it was
        // unmounted (navigated away) while a batch keeps running in the worker.
        sendResponse({ isTagging: isAutoTagging, done: autoTagDone, total: autoTagTotal });
        return false;
    }

    if (message.type === 'AI_SEARCH') {
        searchBookmarks(
            message.query as string,
            message.bookmarks as Array<{ title: string; url: string }>
        )
            .then(urls => sendResponse({ urls }))
            .catch(err => sendResponse({ error: String(err), urls: [] }));
        return true; // async response
    }

    return false;
});

let isBatchCapturing = false;
let stopBatchCapture = false;
let batchController: AbortController | null = null;

let isAutoTagging = false;
let stopAutoTagFlag = false;
let autoTagController: AbortController | null = null;
// Mirrored progress so a re-opened popup can restore its indicator (GET_TAG_STATUS).
let autoTagDone = 0;
let autoTagTotal = 0;
// Cloud providers are network-bound — tag several at once. On-device Nano is a
// single local model, so it stays sequential to avoid thrashing.
const AUTO_TAG_CLOUD_CONCURRENCY = 6;

// Hard cap on waiting for a tab to reach 'complete'. Failed main-frame loads
// short-circuit much sooner via the navError check, so this only bounds pages
// that load successfully-but-slowly or never fire 'complete' (some SPAs).
const LOAD_TIMEOUT_MS = 30000;
// Transient capture failures (not navigation errors) get this many extra tries
// with linear backoff before falling back to an error thumbnail.
const CAPTURE_RETRIES = 1;
const CAPTURE_RETRY_BACKOFF_MS = 600;

function resetBatchState(): void {
    isBatchCapturing = false;
    stopBatchCapture = false;
    batchController = null;
    chrome.runtime.sendMessage({ type: 'BATCH_STOPPED' }).catch(() => { });
}

async function processBatchCapture(
    urls: string[],
    incognitoContext: boolean = false,
    useActiveTabCapture: boolean = false
) {
    if (isBatchCapturing) return;
    isBatchCapturing = true;
    stopBatchCapture = false;
    batchController = new AbortController();
    const signal = batchController.signal;

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
    } catch (e) {
        console.error('Failed to create capture window', e);
        resetBatchState();
        return;
    }

    if (!captureWindow?.id) {
        resetBatchState();
        return;
    }

    // If using active tab capture, serialise (concurrency 1) to avoid focus conflicts
    const CONCURRENCY = useActiveTabCapture ? 1 : 5;
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
        resetBatchState();
        return;
    }

    // Read captureDelay once for the entire batch (not per-URL)
    const stored = await chrome.storage.sync.get(['captureDelay']);
    const captureDelay = Math.max(100, Number(stored.captureDelay || 500));

    let currentIndex = 0;

    const captureSingleUrl = async (tabId: number, url: string) => {
        // Skip non-http(s) URLs (chrome://, file://, javascript:, etc.)
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            chrome.runtime.sendMessage({ type: 'CAPTURE_FAILED', url, error: 'Unsupported URL scheme' }).catch(() => { });
            return;
        }

        let navError: string | null = null;

        const errorListener = (details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
            if (details.tabId === tabId && details.frameId === 0
                && details.error !== 'net::ERR_ABORTED'
                && details.url === url) {
                navError = details.error;
            }
        };
        chrome.webNavigation.onErrorOccurred.addListener(errorListener);

        try {
            chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED', url }).catch(() => { });

            await chrome.tabs.update(tabId, { url, muted: true });

            // Wait for tab to finish loading (cancellable on stop).
            // A single settled-guarded cleanup() owns teardown so the three exit
            // paths (load complete / stop / timeout) can never double-resolve or
            // leave a listener or timer dangling.
            await new Promise<void>((resolve) => {
                let settled = false;
                const cleanup = () => {
                    if (settled) return;
                    settled = true;
                    chrome.tabs.onUpdated.removeListener(listener);
                    clearInterval(stopPoll);
                    clearTimeout(timeout);
                    resolve();
                };
                const listener = (tid: number, changeInfo: { status?: string }) => {
                    if (tid === tabId && changeInfo.status === 'complete') cleanup();
                };
                // Poll for a stop request, or for a navigation error that already
                // fired — a failed main-frame load never reaches 'complete', so
                // without this it would block the worker for the full 30s timeout.
                const stopPoll = setInterval(() => {
                    if (stopBatchCapture || navError) cleanup();
                }, 200);
                const timeout = setTimeout(cleanup, LOAD_TIMEOUT_MS);
                chrome.tabs.onUpdated.addListener(listener);
            });

            chrome.webNavigation.onErrorOccurred.removeListener(errorListener);

            if (stopBatchCapture) return;

            // Wait for render settling (cancellable on stop). Same settled-guarded
            // cleanup pattern as the load wait — no double-resolve, no dangling timer.
            await new Promise<void>((resolve) => {
                let settled = false;
                const cleanup = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    clearInterval(stopPoll);
                    resolve();
                };
                const timeout = setTimeout(cleanup, captureDelay);
                const stopPoll = setInterval(() => {
                    if (stopBatchCapture) cleanup();
                }, 200);
            });

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
                chrome.runtime.sendMessage({ type: 'THUMBNAIL_UPDATED', url, id: url }).catch(() => { });
            } else {
                // Retry transient capture failures (navigation already succeeded, so
                // a failure here is usually a flaky capture, not a dead page).
                await captureTabWithRetry(tabId, url, useActiveTabCapture, captureDelay, signal);
            }
        } catch (rawError: unknown) {
            chrome.webNavigation.onErrorOccurred.removeListener(errorListener);
            // A stop request (flag or abort) shouldn't leave behind an error thumbnail.
            if (stopBatchCapture || signal.aborted) return;
            const errMsg = rawError instanceof Error
                ? rawError.message
                : (typeof rawError === 'object' && rawError !== null && 'message' in rawError)
                    ? String((rawError as { message: unknown }).message)
                    : 'Capture Failed';
            console.error('Failed to capture', url, rawError);
            try {
                const dataUrl = await generateErrorImage(errMsg, url, 'Capture Failed');
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                await thumbnailStorage.putThumbnail({
                    id: url, url, mime: 'image/jpeg', blob,
                    updatedAt: Date.now(), width: 600, height: 400, sizeBytes: blob.size
                });
                await storageIndex.set({
                    id: url, url, title: 'Capture Error', status: 'error', lastCaptureAt: Date.now()
                });
                chrome.runtime.sendMessage({ type: 'THUMBNAIL_UPDATED', url, id: url }).catch(() => { });
            } catch (e) {
                console.error('Failed to generate error fallback', e);
                chrome.runtime.sendMessage({ type: 'CAPTURE_FAILED', url, error: errMsg }).catch(() => { });
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
        resetBatchState();
    }
}

// Auto-capture when a bookmark is created
chrome.bookmarks.onCreated.addListener(async (_id, bookmark) => {
    // Skip while a batch is running: both paths write the same storage keys and
    // would race (last write wins), leaving the blob and its metadata mismatched.
    // The user can regenerate the thumbnail afterwards if needed.
    if (isBatchCapturing) return;
    if (bookmark.url) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        // Re-check after the await — a batch may have started in the interim, and
        // both paths write the same keys.
        if (isBatchCapturing) return;
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
    useActiveTabCapture: boolean,
    renderDelay?: number,
    signal?: AbortSignal
): Promise<{ success: boolean; id: string; dataUrl: string }> {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) throw new Error('Tab has no URL');

    const dataUrl = await captureManager.capture(tabId, { useActiveTabCapture, renderDelay, signal });
    // A stop that landed mid-capture: drop the result rather than writing a tile
    // (and broadcasting an update) after the user asked to stop.
    if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');
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

    // Use `id` (the original bookmark URL) for both key and url field.
    // tab.url may differ due to redirects, but lookups use the original URL.
    await thumbnailStorage.putThumbnail({
        id,
        url: id,
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
        url: id,
        title: tab.title || 'Untitled',
        status,
        lastCaptureAt: Date.now(),
    });

    chrome.runtime.sendMessage({ type: 'THUMBNAIL_UPDATED', url: id, id }).catch(() => { });

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
    useActiveTabCapture: boolean = false,
    renderDelay?: number,
    signal?: AbortSignal
): Promise<{ success: boolean; id: string; dataUrl: string }> {
    return persistCapture(tabId, overrideUrl, useActiveTabCapture, renderDelay, signal);
}

// Retry a capture on transient failure with linear backoff. Aborts immediately
// on a stop request and rethrows the last error once retries are exhausted so
// the caller's error-thumbnail fallback still runs.
async function captureTabWithRetry(
    tabId: number,
    overrideUrl: string,
    useActiveTabCapture: boolean,
    renderDelay: number,
    signal?: AbortSignal
): Promise<{ success: boolean; id: string; dataUrl: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= CAPTURE_RETRIES; attempt++) {
        try {
            return await captureTab(tabId, overrideUrl, useActiveTabCapture, renderDelay, signal);
        } catch (err) {
            lastError = err;
            // Don't retry if we're out of attempts or the user asked to stop.
            if (attempt >= CAPTURE_RETRIES || stopBatchCapture || signal?.aborted) break;
            console.warn(`Capture attempt ${attempt + 1} failed for ${overrideUrl}, retrying`, err);
            await new Promise(resolve => setTimeout(resolve, CAPTURE_RETRY_BACKOFF_MS * (attempt + 1)));
        }
    }
    throw lastError;
}

// ─── AI Auto-Tagging ──────────────────────────────────────────────────────────

// Per-item errors are skipped so the rest of the batch still gets tagged. But if
// many fail back-to-back with a non-fatal error (e.g. the network just dropped),
// stop rather than grind through hundreds of doomed calls. Fatal/config errors
// abort on the first occurrence (see isFatalAIError).
const AUTO_TAG_MAX_CONSECUTIVE_FAILS = 10;

async function processAutoTag(bookmarks: Array<{ url: string; title: string }>): Promise<void> {
    if (isAutoTagging) return;
    if (bookmarks.length === 0) return; // nothing to do — don't broadcast a start/done cycle
    isAutoTagging = true;
    stopAutoTagFlag = false;
    autoTagController = new AbortController();
    autoTagDone = 0;
    autoTagTotal = 0;

    // Pre-flight: don't churn through hundreds of bookmarks if AI isn't usable at all.
    const availability = await checkAIAvailability().catch(() => 'unsupported' as const);
    if (availability === 'unavailable' || availability === 'unsupported') {
        isAutoTagging = false;
        autoTagController = null;
        const reason = availability === 'unsupported'
            ? 'AI is not available. Enable Chrome\'s built-in AI (Chrome 138+) or add an API key in Provider Settings.'
            : 'The selected AI provider is not ready. Check your API key / model in Provider Settings.';
        chrome.runtime.sendMessage({ type: 'TAG_BATCH_FAILED', error: reason }).catch(() => { });
        return;
    }

    // Cloud is network-bound → tag several at once; on-device Nano stays sequential.
    const { settings } = await loadAISettings();
    const concurrency = settings.mode === 'cloud' ? AUTO_TAG_CLOUD_CONCURRENCY : 1;

    autoTagTotal = bookmarks.length;
    chrome.runtime.sendMessage({ type: 'TAG_BATCH_STARTED', total: bookmarks.length }).catch(() => { });

    let count = 0;
    let failCount = 0;
    let consecutiveFails = 0;
    let lastError = '';
    let aborted = false;
    let fatal = false;
    let nextIndex = 0;

    const reportFatal = (error: string) => {
        if (fatal) return;
        fatal = true;
        chrome.runtime.sendMessage({ type: 'TAG_BATCH_FAILED', error }).catch(() => { });
        autoTagController?.abort(); // unblock the other workers' in-flight calls
    };

    const worker = async (): Promise<void> => {
        while (!stopAutoTagFlag && !fatal && !autoTagController!.signal.aborted) {
            const i = nextIndex++;
            if (i >= bookmarks.length) break;
            const { url, title } = bookmarks[i];
            try {
                const tags = await tagBookmark(title, url, autoTagController!.signal);
                const existing = await storageIndex.get(url);
                if (existing) await storageIndex.set({ ...existing, tags });
                else await storageIndex.set({ id: url, url, title, status: 'none', tags });
                count++; autoTagDone++; consecutiveFails = 0;
                chrome.runtime.sendMessage({ type: 'TAG_UPDATED', url, tags }).catch(() => { });
            } catch (err) {
                // A Stop/abort isn't a real failure.
                if (stopAutoTagFlag || autoTagController!.signal.aborted) { aborted = true; break; }
                lastError = friendlyError(err);
                failCount++; autoTagDone++;
                console.warn('[AutoTag] Failed to tag bookmark', url, err);
                if (settings.mode === 'builtin') invalidateAITemplate();

                // Config errors fail identically for every bookmark — stop the batch.
                if (isFatalAIError(lastError)) {
                    reportFatal(`${lastError} This affects every bookmark — fix it in Provider Settings, then try again. (${count} tagged before stopping.)`);
                    break;
                }
                chrome.runtime.sendMessage({ type: 'TAG_FAILED', url, error: lastError }).catch(() => { });

                // Rate-limit (429) is expected under concurrency on free tiers — skip
                // it but DON'T count it toward the circuit-breaker (re-run later).
                if (!/rate.?limit/i.test(lastError)) {
                    consecutiveFails++;
                    if (consecutiveFails >= AUTO_TAG_MAX_CONSECUTIVE_FAILS) {
                        reportFatal(`Stopped after ${consecutiveFails} consecutive failures — likely a connection or provider problem. Last error: ${lastError} (${count} tagged.)`);
                        break;
                    }
                }
            }
        }
    };

    try {
        const pool = Math.min(concurrency, bookmarks.length);
        await Promise.all(Array.from({ length: pool }, () => worker()));
    } catch (err) {
        console.error('[AutoTag] Batch failed', err);
        invalidateAITemplate();
        reportFatal(friendlyError(err));
    } finally {
        isAutoTagging = false;
        stopAutoTagFlag = false;
        autoTagController = null;
    }
    if (!fatal) {
        chrome.runtime.sendMessage({ type: 'TAG_BATCH_DONE', count, failCount, aborted }).catch(() => { });
    }
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
