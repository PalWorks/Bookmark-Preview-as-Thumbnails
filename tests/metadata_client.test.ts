// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { patchMetadata } from '../src/lib/metadata_client';
import { StorageIndex } from '../src/lib/storage_index';
import { localStore } from './setup';

const URL_A = 'https://example.com/a';
const send = () => chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;

describe('patchMetadata', () => {
    it('sends META_PATCH and does not write locally when the worker answers ok', async () => {
        send().mockResolvedValueOnce({ ok: true });
        await patchMetadata(URL_A, { tags: ['Dev'] }, 'Title');
        expect(send()).toHaveBeenCalledWith({ type: 'META_PATCH', id: URL_A, update: { tags: ['Dev'] }, titleIfNew: 'Title' });
        expect(localStore[`meta_${URL_A}`]).toBeUndefined();
    });

    it('falls back to a local merge when the worker is unreachable', async () => {
        localStore[`meta_${URL_A}`] = { id: URL_A, url: URL_A, title: 'Kept', status: 'saved_indexeddb', lastCaptureAt: 3 };
        send().mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));
        await patchMetadata(URL_A, { tags: ['Dev'] }, 'Ignored for existing');
        expect(localStore[`meta_${URL_A}`]).toEqual({ id: URL_A, url: URL_A, title: 'Kept', status: 'saved_indexeddb', lastCaptureAt: 3, tags: ['Dev'] });
    });

    it('rethrows an error reply instead of writing behind the worker', async () => {
        send().mockResolvedValueOnce({ ok: false, error: 'META_PATCH rejected: not an extension page' });
        await expect(patchMetadata(URL_A, { tags: ['Dev'] })).rejects.toThrow('not an extension page');
        expect(localStore[`meta_${URL_A}`]).toBeUndefined();
    });
});

describe('StorageIndex.patch defaultsIfNew', () => {
    it('applies defaults only when the record is new', async () => {
        const index = new StorageIndex();
        await index.patch(URL_A, { tags: ['A'] }, { title: 'Bookmark title' });
        expect(localStore[`meta_${URL_A}`]).toMatchObject({ title: 'Bookmark title', tags: ['A'] });
        await index.patch(URL_A, { title: 'Captured title' });
        await index.patch(URL_A, { tags: ['B'] }, { title: 'Bookmark title' });
        expect(localStore[`meta_${URL_A}`]).toMatchObject({ title: 'Captured title', tags: ['B'] });
    });
});
