import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBWrapper } from '../src/lib/indexeddb';
import 'fake-indexeddb/auto';

describe('IndexedDBWrapper', () => {
    let dbWrapper: IndexedDBWrapper;

    beforeEach(() => {
        dbWrapper = new IndexedDBWrapper();
    });

    it('should open database successfully', async () => {
        const db = await dbWrapper.open();
        expect(db).toBeDefined();
        expect(db.name).toBe('bookmarks_thumbs');
    });

    it('should put and get thumbnail', async () => {
        const record = {
            id: 'test-id',
            url: 'https://example.com',
            mime: 'image/png',
            blob: new Blob(['test'], { type: 'image/png' }),
            updatedAt: Date.now(),
            width: 100,
            height: 100,
            sizeBytes: 4,
        };

        await dbWrapper.putThumbnail(record);
        const retrieved = await dbWrapper.getThumbnail('test-id');

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe('test-id');
        expect(retrieved?.url).toBe('https://example.com');
    });

    it('should delete thumbnail', async () => {
        const record = {
            id: 'test-id-2',
            url: 'https://example.com/2',
            mime: 'image/png',
            blob: new Blob(['test'], { type: 'image/png' }),
            updatedAt: Date.now(),
            width: 100,
            height: 100,
            sizeBytes: 4,
        };

        await dbWrapper.putThumbnail(record);
        await dbWrapper.deleteThumbnail('test-id-2');
        const retrieved = await dbWrapper.getThumbnail('test-id-2');

        expect(retrieved).toBeUndefined();
    });
});
