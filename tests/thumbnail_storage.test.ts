import { describe, it, expect, beforeEach } from 'vitest';
import { ThumbnailStorage } from '../src/lib/thumbnail_storage';
import { localStore } from './setup';

describe('ThumbnailStorage', () => {
    let storage: ThumbnailStorage;

    beforeEach(() => {
        storage = new ThumbnailStorage();
    });

    const makeRecord = (id = 'https://example.com') => ({
        id,
        url: id,
        mime: 'image/webp',
        blob: new Blob(['fake-image'], { type: 'image/webp' }),
        updatedAt: 1000,
        width: 600,
        height: 400,
        sizeBytes: 10,
    });

    // ── putThumbnail ─────────────────────────────────────────────────────────

    it('putThumbnail() stores under thumb_ prefix', async () => {
        await storage.putThumbnail(makeRecord());
        expect(localStore['thumb_https://example.com']).toBeDefined();
        expect(localStore['https://example.com']).toBeUndefined();
    });

    it('putThumbnail() converts blob to base64 string for storage', async () => {
        await storage.putThumbnail(makeRecord());
        const stored = localStore['thumb_https://example.com'] as Record<string, unknown>;
        expect(typeof stored.base64).toBe('string');
        expect((stored.base64 as string).startsWith('data:')).toBe(true);
    });

    it('putThumbnail() preserves metadata fields', async () => {
        const record = makeRecord();
        await storage.putThumbnail(record);
        const stored = localStore['thumb_https://example.com'] as Record<string, unknown>;
        expect(stored.id).toBe(record.id);
        expect(stored.url).toBe(record.url);
        expect(stored.mime).toBe(record.mime);
        expect(stored.width).toBe(record.width);
        expect(stored.height).toBe(record.height);
    });

    it('putThumbnail() does not store the raw Blob object', async () => {
        await storage.putThumbnail(makeRecord());
        const stored = localStore['thumb_https://example.com'] as Record<string, unknown>;
        // The raw blob property must be absent — only base64 is stored
        expect(stored.blob).toBeUndefined();
    });

    // ── getThumbnail ─────────────────────────────────────────────────────────

    it('getThumbnail() returns undefined for a missing id', async () => {
        const result = await storage.getThumbnail('https://missing.example');
        expect(result).toBeUndefined();
    });

    it('getThumbnail() round-trips: stored blob is returned as a Blob', async () => {
        const record = makeRecord();
        await storage.putThumbnail(record);
        const retrieved = await storage.getThumbnail(record.id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.blob).toBeInstanceOf(Blob);
    });

    it('getThumbnail() preserves id, url, mime after round-trip', async () => {
        const record = makeRecord();
        await storage.putThumbnail(record);
        const retrieved = await storage.getThumbnail(record.id);
        expect(retrieved!.id).toBe(record.id);
        expect(retrieved!.url).toBe(record.url);
        expect(retrieved!.mime).toBe(record.mime);
    });

    it('getThumbnail() returns metadata-only record (no blob) when base64 is absent', async () => {
        // Simulate a record written without image data (metadata-only)
        localStore['thumb_https://meta-only.example'] = {
            id: 'https://meta-only.example',
            url: 'https://meta-only.example',
            mime: 'image/webp',
            updatedAt: 2000,
            width: 0,
            height: 0,
            sizeBytes: 0,
            // no base64 field
        };
        const result = await storage.getThumbnail('https://meta-only.example');
        expect(result).toBeDefined();
        expect(result!.id).toBe('https://meta-only.example');
        expect(result!.blob).toBeUndefined();
    });

    // ── deleteThumbnail ──────────────────────────────────────────────────────

    it('deleteThumbnail() removes the thumb_ key from storage', async () => {
        await storage.putThumbnail(makeRecord());
        await storage.deleteThumbnail('https://example.com');
        expect(localStore['thumb_https://example.com']).toBeUndefined();
    });

    it('deleteThumbnail() makes the record unreachable', async () => {
        await storage.putThumbnail(makeRecord());
        await storage.deleteThumbnail('https://example.com');
        const result = await storage.getThumbnail('https://example.com');
        expect(result).toBeUndefined();
    });

    // ── getAllThumbnails ──────────────────────────────────────────────────────

    it('getAllThumbnails() returns only thumb_-prefixed records', async () => {
        await storage.putThumbnail(makeRecord('https://a.example'));
        await storage.putThumbnail(makeRecord('https://b.example'));
        // Noise entries
        localStore['meta_https://a.example'] = { id: 'noise' };
        localStore['hasSeenWelcome'] = true;

        const all = await storage.getAllThumbnails();
        expect(all).toHaveLength(2);
        expect(all.map(r => r.id)).toContain('https://a.example');
        expect(all.map(r => r.id)).toContain('https://b.example');
    });

    it('getAllThumbnails() returns an empty array when no thumbnails exist', async () => {
        localStore['meta_x'] = {};
        const all = await storage.getAllThumbnails();
        expect(all).toHaveLength(0);
    });
});
