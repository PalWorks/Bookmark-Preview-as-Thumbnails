// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore, EXTENSION_ORIGIN } from './setup';
import { makeService, entries, progressOf, seedRecipes } from './trash_helpers';
import { handleTrashMessage } from '../src/sw/trash';

describe('TRASH_DELETE', () => {
    it('snapshots a folder subtree, removes it, and records ancestry and scope', async () => {
        const { folder } = seedRecipes();
        const { service, broadcast } = makeService();
        const res = await service.deleteItems({ ids: [folder.id], requestId: 'r1' });

        expect(res.ok).toBe(true);
        expect(res.removedCount).toBe(4);
        expect(res.removedRoots).toBe(1);
        expect(res.firstTitle).toBe('Recipes');
        expect(fakeBookmarks.has(folder.id)).toBe(false);

        const [entry] = entries();
        expect(entry.title).toBe('Recipes');
        expect(entry.isFolder).toBe(true);
        expect(entry.bookmarkCount).toBe(4);
        expect(entry.nodeCount).toBe(6);
        expect(entry.parentId).toBe('1');
        expect(entry.index).toBe(1);
        expect(entry.ancestors).toEqual([{ oldId: '1', title: 'Bookmarks bar' }]);
        expect(entry.scope).toEqual({ rootId: '1', rootTitle: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: false });
        expect(entry.tree.children!.map(c => c.title)).toEqual(['Soup', 'Cake', 'Drinks', 'Pie']);
        expect(entry.expiresAt - entry.deletedAt).toBe(30 * 24 * 60 * 60 * 1000);
        expect(progressOf(entry.entryId).state).toBe('deleted');
        expect(localStore.trash_rev).toBeTypeOf('number');
        expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'TRASH_CHANGED' }));
    });

    it('a bookmark moved into the folder during the delete is in the snapshot too', async () => {
        const { folder } = seedRecipes();
        const stray = fakeBookmarks.seed('2', 'Moved in', 'https://moved.example/');
        const { service } = makeService();
        const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
        const real = set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>;
        let moved = false;
        set.mockImplementation((items: Record<string, unknown>) => {
            // While the snapshot is being written, another tab moves a bookmark in.
            if (!moved && Object.keys(items).some(k => k.startsWith('trash_v1_'))) {
                moved = true;
                fakeBookmarks.relocate(stray.id, folder.id);
            }
            return real(items);
        });
        await service.deleteItems({ ids: [folder.id] });
        set.mockImplementation(real);
        const entry = entries()[0];
        expect(entry.tree.children!.map(c => c.title)).toContain('Moved in');
        expect(entry.bookmarkCount).toBe(5);
        await service.restore({ operationId: entry.operationId });
        expect(fakeBookmarks.allBookmarks().some(b => b.url === 'https://moved.example/')).toBe(true);
    });

    it('stores no image data in the entry', async () => {
        const { soup } = seedRecipes();
        localStore['thumb_https://soup.example/'] = { id: 'https://soup.example/', base64: 'data:image/webp;base64,AAAA' };
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id] });
        expect(JSON.stringify(entries())).not.toContain('base64');
        // The cached preview stays for a later restore.
        expect(localStore['thumb_https://soup.example/']).toBeDefined();
    });

    it('removes nothing when the snapshot cannot be saved', async () => {
        const { folder } = seedRecipes();
        const { service } = makeService();
        const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
        const real = set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>;
        set.mockImplementationOnce(() => Promise.reject(new Error('QUOTA_BYTES quota exceeded')));
        set.mockImplementation(real);
        const res = await service.deleteItems({ ids: [folder.id] });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/nothing was deleted/i);
        expect(fakeBookmarks.has(folder.id)).toBe(true);
        expect(entries()).toHaveLength(0);
    });

    it('rejects the whole request when one id is a permanent folder', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        const res = await service.deleteItems({ ids: [soup.id, '1'] });
        expect(res.ok).toBe(false);
        expect(res.rejected).toEqual([{ id: '1', title: 'Bookmarks bar', reason: 'permanent' }]);
        expect(fakeBookmarks.has(soup.id)).toBe(true);
        expect(entries()).toHaveLength(0);
    });

    it('rejects managed nodes and folders containing them', async () => {
        const managed = fakeBookmarks.seed('2', 'Company', undefined, { unmodifiable: 'managed' } as Partial<chrome.bookmarks.BookmarkTreeNode>);
        const plain = fakeBookmarks.seed('2', 'Mine');
        fakeBookmarks.seed(plain.id, 'Policy', 'https://policy.example/', { unmodifiable: 'managed' } as Partial<chrome.bookmarks.BookmarkTreeNode>);
        const { service } = makeService();
        const a = await service.deleteItems({ ids: [managed.id] });
        expect(a.rejected?.[0].reason).toBe('managed');
        const b = await service.deleteItems({ ids: [plain.id] });
        expect(b.rejected?.[0]).toMatchObject({ id: plain.id, reason: 'managed' });
        expect(fakeBookmarks.has(plain.id)).toBe(true);
    });

    it('skips ids that no longer exist and deletes the rest', async () => {
        const { soup, cake } = seedRecipes();
        const { service } = makeService();
        const res = await service.deleteItems({ ids: [soup.id, '99999', cake.id] });
        expect(res.ok).toBe(true);
        expect(res.skipped).toEqual(['99999']);
        expect(res.removedRoots).toBe(2);
        expect(entries()).toHaveLength(2);
        expect(new Set(entries().map(e => e.operationId)).size).toBe(1);
    });

    it('drops ids nested inside another selected folder', async () => {
        const { folder, soup, tea } = seedRecipes();
        const { service } = makeService();
        const res = await service.deleteItems({ ids: [soup.id, folder.id, tea.id] });
        expect(res.removedRoots).toBe(1);
        expect(entries()).toHaveLength(1);
        expect(entries()[0].title).toBe('Recipes');
    });

    it('a retried request with the same requestId is a no-op', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        const first = await service.deleteItems({ ids: [soup.id], requestId: 'same' });
        const second = await service.deleteItems({ ids: [soup.id], requestId: 'same' });
        expect(second).toEqual(first);
        expect(entries()).toHaveLength(1);
    });

    it('a retry after the worker died mid-delete continues the same operation', async () => {
        const { soup, cake, pie } = seedRecipes();
        const { service } = makeService();
        // First attempt: snapshot written and Soup removed, then the worker dies.
        fakeBookmarks.failAfter('remove', 1, 'worker killed');
        const first = await service.deleteItems({ ids: [soup.id, cake.id, pie.id], requestId: 'rq' });
        // Simulate the crash: the answer was never cached.
        const cached = localStore['trash_req_rq'] as { operationId: string };
        localStore['trash_req_rq'] = { at: 1, operationId: cached.operationId };
        const fresh = makeService();
        const retry = await fresh.service.deleteItems({ ids: [soup.id, cake.id, pie.id], requestId: 'rq' });
        expect(retry.operationId).toBe(first.operationId);
        expect(new Set(entries().map(e => e.operationId)).size).toBe(1);
    });

    it('a retry after every item was already removed still names the first operation', async () => {
        const { soup, cake } = seedRecipes();
        const { service } = makeService();
        const first = await service.deleteItems({ ids: [soup.id, cake.id], requestId: 'cs_x' });
        // The worker stopped after removing everything but before caching the answer.
        localStore['trash_req_cs_x'] = { at: Date.now(), operationId: first.operationId };
        const retry = await makeService().service.deleteItems({ ids: [soup.id, cake.id], requestId: 'cs_x' });
        expect(retry.ok).toBe(true);
        expect(retry.removedRoots).toBe(0);
        expect(retry.operationId).toBe(first.operationId);
    });

    it('still reports success when recording the outcome fails after removal', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
        const real = set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>;
        let calls = 0;
        set.mockImplementation((items: Record<string, unknown>) => {
            calls++;
            // Call 1 is the snapshot; call 2 is the outcome write.
            return calls === 2 ? Promise.reject(new Error('disk full')) : real(items);
        });
        const res = await service.deleteItems({ ids: [soup.id] });
        set.mockImplementation(real);
        expect(res.ok).toBe(true);
        expect(fakeBookmarks.has(soup.id)).toBe(false);
        await makeService().service.reconcile();
        expect(progressOf(entries()[0].entryId).state).toBe('deleted');
    });

    it('a delete above the size limit gets a readable error', async () => {
        const { service } = makeService();
        const res = await handleTrashMessage(service, { type: 'TRASH_DELETE', ids: Array.from({ length: 10001 }, (_, i) => String(i)) },
            { url: `${EXTENSION_ORIGIN}index.html` } as chrome.runtime.MessageSender, false);
        expect((res as { error: string }).error).toMatch(/Too many items for one delete/);
    });

    it('records per-root outcomes when one removal fails', async () => {
        const { soup, cake, pie } = seedRecipes();
        fakeBookmarks.failAfter('remove', 1, 'Boom');
        const { service } = makeService();
        const res = await service.deleteItems({ ids: [soup.id, cake.id, pie.id] });
        expect(res.ok).toBe(true);
        expect(res.removedRoots).toBe(2);
        expect(res.failed).toEqual([{ id: cake.id, error: 'Boom' }]);
        expect(fakeBookmarks.has(cake.id)).toBe(true);
        expect(entries().map(e => e.title).sort()).toEqual(['Pie', 'Soup']);
    });

    it('marks entries from Duplicate Finder', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        await service.deleteItems({ ids: [soup.id], origin: 'duplicate-finder' });
        expect(entries()[0].origin).toBe('duplicate-finder');
    });

    it('an empty selection after nesting removal does nothing', async () => {
        const { service } = makeService();
        const res = await service.deleteItems({ ids: ['424242'] });
        expect(res).toMatchObject({ ok: true, removedRoots: 0, skipped: ['424242'] });
        expect(localStore.trash_rev).toBeUndefined();
    });
});

describe('handleTrashMessage', () => {
    const page = { url: `${EXTENSION_ORIGIN}index.html` } as chrome.runtime.MessageSender;

    it('rejects messages from content scripts and web pages', async () => {
        const { service } = makeService();
        const res = await handleTrashMessage(service, { type: 'TRASH_EMPTY' }, { url: 'https://evil.example/', tab: { id: 1 } as chrome.tabs.Tab }, false);
        expect(res).toMatchObject({ ok: false });
        expect(String((res as { error: string }).error)).toMatch(/not an extension page/);
    });

    it('is read-only in the incognito worker', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        const res = await handleTrashMessage(service, { type: 'TRASH_DELETE', ids: [soup.id] }, page, true);
        expect(res).toMatchObject({ ok: false, error: 'Trash works in regular windows only.' });
        expect(fakeBookmarks.has(soup.id)).toBe(true);
    });

    it('validates payloads', async () => {
        const { service } = makeService();
        expect(await handleTrashMessage(service, { type: 'TRASH_DELETE', ids: 'x' }, page, false)).toMatchObject({ ok: false });
        expect(await handleTrashMessage(service, { type: 'TRASH_DELETE', ids: [] }, page, false)).toMatchObject({ ok: false });
        expect(await handleTrashMessage(service, { type: 'TRASH_DELETE', ids: [1] }, page, false)).toMatchObject({ ok: false });
        expect(await handleTrashMessage(service, { type: 'TRASH_RESTORE' }, page, false)).toMatchObject({ ok: false });
    });

    it('routes a valid delete', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        const res = await handleTrashMessage(service, { type: 'TRASH_DELETE', ids: [soup.id], origin: 'bogus' }, page, false);
        expect(res).toMatchObject({ ok: true, removedRoots: 1 });
        expect(entries()[0].origin).toBe('manual');
    });
});
