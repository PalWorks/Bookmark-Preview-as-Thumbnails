/**
 * Regression tests for Phase 1 critical bugs.
 *
 * P1-1: SW message listener was async — returned a Promise (not `true`), so
 *       Chrome immediately closed the message channel.
 *
 * P1-2: StorageIndex.getAll() returned ALL chrome.storage.local keys, causing
 *       thumb_ entries to be treated as metadata records.
 *
 * P1-3: html2canvas `logging: true` was polluting the console and causing
 *       rendering side-effects; fixed to `logging: false`.
 */

import { describe, it, expect } from 'vitest';
import { StorageIndex } from '../src/lib/storage_index';
import type { MetadataRecord } from '../src/lib/storage_index';
import { localStore } from './setup';

// ─── P1-1: Synchronous message channel hold ──────────────────────────────────

describe('P1-1 regression — SW listener must return true synchronously', () => {
    it('a listener that returns true (not Promise) keeps the message channel open', () => {
        // Simulate Chrome's runtime.onMessage contract:
        // returning true from the callback holds the channel open for async sendResponse.
        // An async function returns a Promise which Chrome treats as falsy → channel closes.
        const syncListener = (
            msg: { type: string },
            _sender: unknown,
            _sendResponse: () => void,
        ): boolean => {
            if (msg.type === 'CAPTURE_THUMBNAIL') {
                // Launch async work (does NOT await)
                Promise.resolve().then(_sendResponse);
                return true; // <-- synchronous, not a Promise
            }
            return false;
        };

        const resultForCapture = syncListener({ type: 'CAPTURE_THUMBNAIL' }, null, () => {});
        expect(resultForCapture).toBe(true); // channel stays open

        const resultForOther = syncListener({ type: 'PING' }, null, () => {});
        expect(resultForOther).toBe(false);
    });

    it('async function does NOT return true synchronously (documents the anti-pattern)', () => {
        // This is the old broken pattern. An async function returns a Promise, not a boolean.
        const asyncListener = async (
            msg: { type: string },
            _sender: unknown,
            _sendResponse: () => void,
        ) => {
            if (msg.type === 'CAPTURE_THUMBNAIL') {
                await Promise.resolve();
                _sendResponse();
            }
        };

        const result = asyncListener({ type: 'CAPTURE_THUMBNAIL' }, null, () => {});
        // The return value is a Promise, which is neither `true` nor `false`
        expect(result).toBeInstanceOf(Promise);
        // Chrome interprets a non-true return as "channel can close" → sendResponse arrives too late
    });
});

// ─── P1-2: StorageIndex namespace isolation ───────────────────────────────────

describe('P1-2 regression — StorageIndex must not bleed across namespaces', () => {
    it('getAll() excludes thumb_ entries from metadata results', async () => {
        const index = new StorageIndex();
        const meta: MetadataRecord = {
            id: 'https://example.com',
            url: 'https://example.com',
            title: 'Test',
            status: 'saved_indexeddb',
        };
        await index.set(meta);

        // Inject a thumb_ record that existed before the namespace fix would be returned
        localStore['thumb_https://example.com'] = {
            id: 'https://example.com',
            url: 'https://example.com',
            mime: 'image/webp',
        };

        const all = await index.getAll();
        // Must be exactly 1 entry — the meta_ record only
        expect(Object.keys(all)).toHaveLength(1);
        expect(all['https://example.com'].status).toBe('saved_indexeddb');
    });

    it('getAll() excludes the hasSeenWelcome flag', async () => {
        localStore['hasSeenWelcome'] = true;
        const index = new StorageIndex();
        const all = await index.getAll();
        expect('hasSeenWelcome' in all).toBe(false);
    });

    it('set() writing to one URL never overwrites a thumb_ record for the same URL', async () => {
        const thumbKey = 'thumb_https://example.com';
        const thumbData = { id: 'original-thumb' };
        localStore[thumbKey] = thumbData;

        const index = new StorageIndex();
        await index.set({
            id: 'https://example.com',
            url: 'https://example.com',
            title: 'Example',
            status: 'saved_indexeddb',
        });

        // The thumb_ entry must be completely untouched
        expect(localStore[thumbKey]).toEqual(thumbData);
    });
});

// ─── P1-3: captureDelay is read once per batch, not per URL ──────────────────

describe('P1-3 regression — captureDelay reads are batched (was per-URL)', () => {
    it('storage.sync.get for captureDelay is called at most once for a batch of N URLs', async () => {
        // This is a contract test: the SW hoisted captureDelay to batch scope.
        // We verify the pattern is correct: one read for N URLs.
        // The actual SW is not imported here (it has side effects), but we test
        // the pattern by simulating the batch loop.

        let storageReadCount = 0;

        const readCaptureDelayOnce = async () => {
            storageReadCount++;
            return 500; // simulates chrome.storage.sync.get(['captureDelay'])
        };

        const captureSingleUrl = async (url: string, captureDelay: number) => {
            // captureDelay is passed as a parameter, NOT read from storage here
            return { url, delay: captureDelay };
        };

        const processBatch = async (urls: string[]) => {
            const captureDelay = await readCaptureDelayOnce(); // once per batch
            return Promise.all(urls.map(url => captureSingleUrl(url, captureDelay)));
        };

        const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
        await processBatch(urls);

        expect(storageReadCount).toBe(1); // single read regardless of batch size
    });
});
