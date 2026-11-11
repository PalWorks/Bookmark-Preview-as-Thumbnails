// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore } from './setup';
import { makeService, entries, progressOf, seedRecipes, clock } from './trash_helpers';
import { db } from '../src/lib/indexeddb';
import { readTrash, groupOperations, trashBadgeCount } from '../src/lib/trash_store';

const DAY = 24 * 60 * 60 * 1000;
const thumb = (url: string) => { localStore[`thumb_${url}`] = { id: url, url, base64: 'data:image/webp;base64,AAAA' }; };
const meta = (url: string) => { localStore[`meta_${url}`] = { id: url, url, title: 'x', status: 'saved_indexeddb', tags: ['T'] }; };

describe('reconcile', () => {
    it('drops a prepared entry whose bookmark still exists (the delete never happened)', async () => {
        const { soup } = seedRecipes();
        localStore.trash_v1_e1 = { version: 1, entryId: 'e1', operationId: 'o1', tree: { oldId: soup.id, title: 'Soup', url: 'https://soup.example/' }, ancestors: [], scope: {}, index: 0, parentId: '1' };
        localStore.trash_prog_e1 = { entryId: 'e1', state: 'prepared', updatedAt: 0 };
        const { service } = makeService();
        await service.reconcile();
        expect(localStore.trash_v1_e1).toBeUndefined();
        expect(localStore.trash_prog_e1).toBeUndefined();
    });

    it('promotes a prepared entry whose bookmark is gone to deleted', async () => {
        localStore.trash_v1_e2 = { version: 1, entryId: 'e2', operationId: 'o2', tree: { oldId: '98765', title: 'Gone', url: 'https://gone.example/' }, ancestors: [], scope: {}, index: 0, parentId: '1' };
        localStore.trash_prog_e2 = { entryId: 'e2', state: 'prepared', updatedAt: 0 };
        const { service } = makeService();
        await service.reconcile();
        expect(progressOf('e2').state).toBe('deleted');
    });

    it('removes progress without an entry and adopts an entry without progress', async () => {
        localStore.trash_prog_lonely = { entryId: 'lonely', state: 'deleted', updatedAt: 0 };
        localStore.trash_v1_bare = { version: 1, entryId: 'bare', operationId: 'o3', tree: { oldId: '5555', title: 'B' }, ancestors: [], scope: {}, index: 0, parentId: '1' };
        const { service } = makeService();
        await service.reconcile();
        expect(localStore.trash_prog_lonely).toBeUndefined();
        expect(progressOf('bare').state).toBe('deleted');
    });
});

describe('TRASH_EMPTY and the asset sweep', () => {
    it('purges previews and metadata of URLs nothing else uses, keeps shared ones', async () => {
        const { folder } = seedRecipes();
        // Cake is also bookmarked elsewhere: its preview must survive.
        fakeBookmarks.seed('2', 'Cake copy', 'https://cake.example/');
        for (const u of ['https://soup.example/', 'https://cake.example/', 'https://tea.example/']) { thumb(u); meta(u); }
        const { service } = makeService();
        await service.deleteItems({ ids: [folder.id] });
        const res = await service.empty();
        expect(res).toMatchObject({ ok: true, removedEntries: 1, removedBookmarks: 4 });
        expect(entries()).toHaveLength(0);
        expect(localStore['thumb_https://soup.example/']).toBeUndefined();
        expect(localStore['meta_https://soup.example/']).toBeUndefined();
        expect(localStore['thumb_https://tea.example/']).toBeUndefined();
        expect(localStore['thumb_https://cake.example/']).toBeDefined();
        expect(localStore['meta_https://cake.example/']).toBeDefined();
        expect(localStore.trash_purge_pending).toBeUndefined();
    });

    it('expiring a restored entry still purges previews nothing uses any more', async () => {
        const { soup } = seedRecipes();
        thumb('https://soup.example/');
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [soup.id] });
        const res = await service.restore({ operationId: del.operationId });
        await chrome.bookmarks.remove(res.results![0].restoredTo!.rootId); // later deleted elsewhere
        clock.t += 11 * 60 * 1000;
        await service.purgeExpired();
        expect(localStore['thumb_https://soup.example/']).toBeUndefined();
    });

    it('also deletes a legacy IndexedDB preview', async () => {
        const { soup } = seedRecipes();
        await db.putThumbnail({ id: 'https://soup.example/', url: 'https://soup.example/', mime: 'image/webp', updatedAt: 1, width: 1, height: 1, sizeBytes: 1 });
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id] });
        await service.empty();
        expect(await db.getThumbnail('https://soup.example/')).toBeUndefined();
    });

    it('keeps a URL queued when the IndexedDB delete fails, and retries later', async () => {
        const { soup } = seedRecipes();
        thumb('https://soup.example/');
        const spy = vi.spyOn(db, 'deleteThumbnail').mockRejectedValueOnce(new Error('IDB broken'));
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id] });
        await service.empty();
        expect(localStore.trash_purge_pending).toMatchObject({ urls: ['https://soup.example/'] });
        spy.mockRestore();
        await service.purgeExpired();
        expect(localStore.trash_purge_pending).toBeUndefined();
    });

    it('resumes a sweep journal left by a crash', async () => {
        thumb('https://orphan.example/');
        localStore.trash_purge_pending = { urls: ['https://orphan.example/'], at: 1 };
        const { service } = makeService();
        await service.purgeExpired();
        expect(localStore['thumb_https://orphan.example/']).toBeUndefined();
        expect(localStore.trash_purge_pending).toBeUndefined();
    });

    it('keeps assets for a URL another Trash entry still holds', async () => {
        const { soup } = seedRecipes();
        const twin = fakeBookmarks.seed('2', 'Soup again', 'https://soup.example/');
        thumb('https://soup.example/');
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id] });
        clock.t += 10 * DAY;
        await service.deleteItems({ ids: [twin.id] });
        clock.t += 21 * DAY; // first entry expired, second has 9 days left
        expect(await service.purgeExpired()).toBe(1);
        expect(entries()).toHaveLength(1);
        expect(localStore['thumb_https://soup.example/']).toBeDefined();
        clock.t += 10 * DAY;
        expect(await service.purgeExpired()).toBe(1);
        expect(localStore['thumb_https://soup.example/']).toBeUndefined();
    });

    it('a URL that cannot be searched keeps its assets', async () => {
        const bm = fakeBookmarks.seed('2', 'Bookmarklet', 'javascript:alert(1)');
        localStore['thumb_javascript:alert(1)'] = { id: 'javascript:alert(1)' };
        const api = chrome.bookmarks as unknown as { search: (q: unknown) => Promise<unknown> };
        const realSearch = api.search;
        api.search = () => Promise.reject(new Error('Invalid URL'));
        const { service } = makeService();
        await service.deleteItems({ ids: [bm.id] });
        await service.empty();
        api.search = realSearch;
        expect(localStore['thumb_javascript:alert(1)']).toBeDefined();
    });
});

describe('expiry', () => {
    it('removes entries after 30 days and restored ones after 10 minutes', async () => {
        const { soup, cake } = seedRecipes();
        thumb('https://soup.example/');
        const { service } = makeService();
        const a = await service.deleteItems({ ids: [soup.id] });
        const b = await service.deleteItems({ ids: [cake.id] });
        await service.restore({ operationId: b.operationId });

        clock.t += 11 * 60 * 1000;
        expect(await service.purgeExpired()).toBe(1); // the restored entry
        expect(entries().map(e => e.operationId)).toEqual([a.operationId]);

        clock.t += 29 * DAY;
        expect(await service.purgeExpired()).toBe(0);
        clock.t += 1 * DAY;
        expect(await service.purgeExpired()).toBe(1);
        expect(entries()).toHaveLength(0);
        expect(localStore['thumb_https://soup.example/']).toBeUndefined();
    });

    it('drops cached delete responses after 10 minutes', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id], requestId: 'req-1' });
        expect(localStore['trash_req_req-1']).toBeDefined();
        clock.t += 11 * 60 * 1000;
        await service.purgeExpired();
        expect(localStore['trash_req_req-1']).toBeUndefined();
    });

    it('keeps an AI change set\'s delete record as long as its Trash entries', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id], requestId: 'cs_1' });
        clock.t += 1 * DAY;
        await service.purgeExpired();
        expect(localStore['trash_req_cs_1']).toBeDefined();
        clock.t += 30 * DAY;
        await service.purgeExpired();
        expect(localStore['trash_req_cs_1']).toBeUndefined();
    });
});

describe('trash_store views', () => {
    it('groups operations newest first and counts bookmarks for the badge', async () => {
        const { folder, before, after } = seedRecipes();
        const { service } = makeService();
        await service.deleteItems({ ids: [before.id, after.id] });
        clock.t += 1000;
        await service.deleteItems({ ids: [folder.id] });
        const items = await readTrash();
        const ops = groupOperations(items);
        expect(ops).toHaveLength(2);
        expect(ops[0].items[0].entry.title).toBe('Recipes');
        expect(ops[1].items.map(i => i.entry.title)).toEqual(['Before', 'After']);
        expect(trashBadgeCount(items)).toBe(6);
    });

    it('falls back to get(null) when getKeys is missing', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id] });
        const area = chrome.storage.local as unknown as { getKeys?: unknown };
        const saved = area.getKeys;
        delete area.getKeys;
        expect(await readTrash()).toHaveLength(1);
        area.getKeys = saved;
    });
});
