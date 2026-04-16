import { describe, it, expect, beforeEach } from 'vitest';
import { StorageIndex } from '../src/lib/storage_index';
import type { MetadataRecord } from '../src/lib/storage_index';
import { localStore } from './setup';

describe('StorageIndex', () => {
    let index: StorageIndex;

    beforeEach(() => {
        index = new StorageIndex();
    });

    const baseRecord: MetadataRecord = {
        id: 'https://example.com',
        url: 'https://example.com',
        title: 'Example',
        status: 'saved_indexeddb',
        lastCaptureAt: 1000,
    };

    // ── set / get ────────────────────────────────────────────────────────────

    it('set() stores the record under the meta_ prefix', async () => {
        await index.set(baseRecord);
        expect(localStore['meta_https://example.com']).toEqual(baseRecord);
    });

    it('set() never writes to the bare (non-prefixed) key', async () => {
        await index.set(baseRecord);
        expect(localStore['https://example.com']).toBeUndefined();
    });

    it('get() retrieves a record by its id (without prefix)', async () => {
        await index.set(baseRecord);
        const result = await index.get(baseRecord.id);
        expect(result).toEqual(baseRecord);
    });

    it('get() returns undefined for a missing id', async () => {
        const result = await index.get('https://nonexistent.example');
        expect(result).toBeUndefined();
    });

    // ── getAll ───────────────────────────────────────────────────────────────

    it('getAll() returns only meta_-prefixed entries', async () => {
        await index.set(baseRecord);
        // Noise keys that must NOT appear
        localStore['thumb_https://example.com'] = { noise: true };
        localStore['hasSeenWelcome'] = true;
        localStore['someLegacyKey'] = { noise: true };

        const all = await index.getAll();
        expect(Object.keys(all)).toHaveLength(1);
        expect(all[baseRecord.id]).toEqual(baseRecord);
    });

    it('getAll() strips the meta_ prefix from the returned map keys', async () => {
        await index.set(baseRecord);
        const all = await index.getAll();
        expect(all['https://example.com']).toBeDefined();
        // The prefixed form must NOT appear as a key
        expect(all['meta_https://example.com']).toBeUndefined();
    });

    it('getAll() returns an empty object when there are no meta_ entries', async () => {
        localStore['thumb_x'] = {};
        localStore['hasSeenWelcome'] = true;
        const all = await index.getAll();
        expect(all).toEqual({});
    });

    it('getAll() handles multiple records correctly', async () => {
        const second: MetadataRecord = {
            id: 'https://example.org',
            url: 'https://example.org',
            title: 'Example Org',
            status: 'error',
        };
        await index.set(baseRecord);
        await index.set(second);

        const all = await index.getAll();
        expect(Object.keys(all)).toHaveLength(2);
        expect(all[baseRecord.id]).toEqual(baseRecord);
        expect(all[second.id]).toEqual(second);
    });

    // ── remove ───────────────────────────────────────────────────────────────

    it('remove() deletes the meta_-prefixed key from storage', async () => {
        await index.set(baseRecord);
        await index.remove(baseRecord.id);
        expect(localStore['meta_https://example.com']).toBeUndefined();
    });

    it('remove() makes the record unreachable via get()', async () => {
        await index.set(baseRecord);
        await index.remove(baseRecord.id);
        const result = await index.get(baseRecord.id);
        expect(result).toBeUndefined();
    });

    // ── namespace isolation ───────────────────────────────────────────────────

    it('thumb_ and meta_ namespaces never collide', async () => {
        // A thumb_ key for the same URL as a meta_ entry
        localStore['thumb_https://example.com'] = { id: 'thumb-noise' };
        await index.set(baseRecord);

        const all = await index.getAll();
        // Only the meta_ entry should appear
        expect(Object.keys(all)).toHaveLength(1);
        // The thumb_ record must be untouched
        expect(localStore['thumb_https://example.com']).toEqual({ id: 'thumb-noise' });
    });

    it('set() on one id does not affect other ids', async () => {
        const other: MetadataRecord = {
            id: 'https://other.example',
            url: 'https://other.example',
            title: 'Other',
            status: 'pending',
        };
        await index.set(baseRecord);
        await index.set(other);
        await index.remove(baseRecord.id);

        const all = await index.getAll();
        expect(all['https://other.example']).toEqual(other);
        expect(all['https://example.com']).toBeUndefined();
    });
});
