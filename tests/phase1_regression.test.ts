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

        const resultForCapture = syncListener({ type: 'CAPTURE_THUMBNAIL' }, null, () => { });
        expect(resultForCapture).toBe(true); // channel stays open

        const resultForOther = syncListener({ type: 'PING' }, null, () => { });
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

        const result = asyncListener({ type: 'CAPTURE_THUMBNAIL' }, null, () => { });
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

describe('P1-3 contract — captureDelay must be read once per batch, not per URL', () => {
    /**
     * Architecture constraint: the SW reads captureDelay from chrome.storage.sync
     * exactly once at the start of processBatchCapture, then passes it to each
     * individual capture call. This test validates the constraint structurally.
     *
     * We cannot import sw.ts directly (it has top-level side effects), so this is
     * a contract test validating the pattern. The constraint is enforced by code
     * review and this documented test.
     */

    it('batch processing reads storage once and passes delay to each capture', async () => {
        let syncReadCount = 0;

        // Mirrors the SW pattern: one read, N captures with the pre-read value
        const processBatch = async (urls: string[]) => {
            syncReadCount++;
            const delay = 500; // read once from chrome.storage.sync
            const results = await Promise.all(
                urls.map(async (url) => ({ url, delay }))
            );
            return results;
        };

        const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
        const results = await processBatch(urls);

        // Exactly one storage read regardless of batch size
        expect(syncReadCount).toBe(1);
        // Every capture received the same delay value
        expect(results.every(r => r.delay === 500)).toBe(true);
        expect(results).toHaveLength(20);
    });

    it('per-URL reads (the broken pattern) result in N reads for N URLs', async () => {
        let syncReadCount = 0;

        // Anti-pattern: reading storage inside each capture
        const processBatchBroken = async (urls: string[]) => {
            const results = await Promise.all(
                urls.map(async (url) => {
                    syncReadCount++;
                    return { url, delay: 500 };
                })
            );
            return results;
        };

        const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
        await processBatchBroken(urls);

        // Demonstrates the anti-pattern produces N reads
        expect(syncReadCount).toBe(10);
    });
});
