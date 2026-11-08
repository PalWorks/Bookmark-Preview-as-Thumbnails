// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { FakeBookmarks, fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore } from './setup';
import { makeService, entries, progressOf, seedRecipes, shape, clock } from './trash_helpers';

describe('TRASH_RESTORE', () => {
    it('Undo puts a folder back with titles, URLs, order, nesting and position', async () => {
        const { folder } = seedRecipes();
        const original = shape(fakeBookmarks.tree(folder.id));
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Before', 'After']);

        const res = await service.restore({ operationId: del.operationId });
        expect(res.ok).toBe(true);
        expect(res.restoredCount).toBe(1);
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Before', 'Recipes', 'After']);
        const restored = res.results![0];
        expect(restored.state).toBe('restored');
        expect(restored.restoredTo).toMatchObject({ parentId: '1', path: ['Bookmarks bar'] });
        expect(shape(fakeBookmarks.tree(restored.restoredTo!.rootId))).toEqual(original);
        expect(progressOf(entries()[0].entryId).state).toBe('restored');
    });

    it('restores several siblings to their original positions', async () => {
        const { folder, soup, sub, pie } = seedRecipes();
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [pie.id, soup.id, sub.id] });
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual(['Cake']);
        await service.restore({ operationId: del.operationId });
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual(['Soup', 'Cake', 'Drinks', 'Pie']);
    });

    it('a double Undo creates one copy, even when sent concurrently', async () => {
        const { folder } = seedRecipes();
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        const [a, b] = await Promise.all([
            service.restore({ operationId: del.operationId }),
            service.restore({ operationId: del.operationId }),
        ]);
        expect(a.restoredCount).toBe(1);
        expect(b.restoredCount).toBe(1); // already restored: reported, not redone
        expect(fakeBookmarks.titlesIn('1').filter(t => t === 'Recipes')).toHaveLength(1);
    });

    it('recreates a missing parent folder once for two roots of one operation', async () => {
        const work = fakeBookmarks.seed('1', 'Work');
        const a = fakeBookmarks.seed(work.id, 'A', 'https://a.example/');
        const b = fakeBookmarks.seed(work.id, 'B', 'https://b.example/');
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [a.id, b.id] });
        await service.deleteItems({ ids: [work.id] }); // the parent is gone too
        const res = await service.restore({ operationId: del.operationId });
        expect(res.restoredCount).toBe(2);
        const works = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Work');
        expect(works).toHaveLength(1);
        expect(works[0].children!.map(c => c.title)).toEqual(['A', 'B']);
    });

    it('fails closed when the original folder moved into synced storage, then restores to a chosen folder', async () => {
        const fb = new FakeBookmarks({ accountStorage: true });
        (globalThis as unknown as { chrome: { bookmarks: unknown } }).chrome.bookmarks = fb.api();
        const local = fb.seed('1', 'Local');
        const item = fb.seed(local.id, 'Secret', 'https://secret.example/');
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [item.id] });
        fb.relocate(local.id, '4'); // the folder now lives in the account (synced) bookmarks bar

        const res = await service.restore({ operationId: del.operationId });
        expect(res.ok).toBe(false);
        expect(res.results![0]).toMatchObject({ state: 'failed', needsDestination: true });
        expect(fb.allBookmarks().some(n => n.url === 'https://secret.example/')).toBe(false);

        const chosen = await service.restore({ operationId: del.operationId, targetParentId: '2' });
        expect(chosen.ok).toBe(true);
        expect(fb.titlesIn('2')).toEqual(['Secret']);
    });

    it('uses a permanent folder of the same type and sync state when the whole root is gone', async () => {
        const fb = new FakeBookmarks({ accountStorage: true });
        (globalThis as unknown as { chrome: { bookmarks: unknown } }).chrome.bookmarks = fb.api();
        const folder = fb.seed('4', 'Synced work');
        const item = fb.seed(folder.id, 'Doc', 'https://doc.example/');
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [item.id] });

        fb.dropPermanent('4'); // signed out: account bookmarks bar disappears
        const missing = await service.restore({ operationId: del.operationId });
        expect(missing.results![0].needsDestination).toBe(true);

        const bar = fb.addPermanent('Bookmarks bar', 'bookmarks-bar', true); // signed back in, new id
        const res = await service.restore({ operationId: del.operationId });
        expect(res.ok).toBe(true);
        expect(fb.titlesIn(bar.id)).toEqual(['Synced work']);
        expect(fb.titlesIn(fb.tree(bar.id).children![0].id)).toEqual(['Doc']);
        // Never into the local bar.
        expect(fb.titlesIn('1')).toEqual([]);
    });

    it('without folderType (older Chrome) falls back to the saved root id', async () => {
        const fb = new FakeBookmarks({ legacyFields: true });
        (globalThis as unknown as { chrome: { bookmarks: unknown } }).chrome.bookmarks = fb.api();
        const folder = fb.seed('2', 'Old');
        const item = fb.seed(folder.id, 'X', 'https://x.example/');
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [item.id, folder.id] });
        expect(entries()[0].scope.folderType).toBeUndefined();
        const res = await service.restore({ operationId: del.operationId });
        expect(res.ok).toBe(true);
        expect(fb.titlesIn('2')).toEqual(['Old']);
    });

    it('rejects a chosen destination that is gone or managed', async () => {
        const { soup } = seedRecipes();
        const managed = fakeBookmarks.seed('2', 'Managed', undefined, { unmodifiable: 'managed' } as Partial<chrome.bookmarks.BookmarkTreeNode>);
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [soup.id] });
        const gone = await service.restore({ operationId: del.operationId, targetParentId: '777777' });
        expect(gone.results![0]).toMatchObject({ state: 'failed', needsDestination: true });
        const m = await service.restore({ operationId: del.operationId, targetParentId: managed.id });
        expect(m.results![0]).toMatchObject({ state: 'failed', needsDestination: true });
    });

    it('resumes an interrupted restore in a fresh worker without duplicates', async () => {
        const { folder } = seedRecipes();
        const original = shape(fakeBookmarks.tree(folder.id));
        const first = makeService();
        const del = await first.service.deleteItems({ ids: [folder.id] });

        clock.t += 60_000;
        fakeBookmarks.failAfter('create', 3, 'Worker stopped');
        const broken = await first.service.restore({ operationId: del.operationId });
        expect(broken.results![0].state).toBe('failed');
        expect(broken.results![0].error).toMatch(/Worker stopped/);

        // A new worker (no shared memory) retries.
        const second = makeService();
        clock.t += 60_000;
        const retry = await second.service.restore({ operationId: del.operationId });
        expect(retry.ok).toBe(true);
        const recipes = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Recipes');
        expect(recipes).toHaveLength(1);
        expect(shape(recipes[0])).toEqual(original);
    });

    it('a restore left mid-way by a dead worker becomes failed, then Retry finishes it', async () => {
        const { folder } = seedRecipes();
        const original = shape(fakeBookmarks.tree(folder.id));
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        const entryId = del.entryIds![0];
        // Simulate death right after two creates: state says restoring.
        fakeBookmarks.failAfter('create', 2, 'killed');
        await service.restore({ operationId: del.operationId });
        localStore[`trash_prog_${entryId}`] = { ...progressOf(entryId), state: 'restoring' };

        const fresh = makeService();
        await fresh.service.reconcile();
        expect(progressOf(entryId)).toMatchObject({ state: 'failed', error: expect.stringMatching(/interrupted/) });
        const res = await fresh.service.restore({ entryId });
        expect(res.ok).toBe(true);
        const recipes = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Recipes');
        expect(recipes).toHaveLength(1);
        expect(shape(recipes[0])).toEqual(original);
    });

    it('turns on the auto-capture guard while restoring', async () => {
        const { soup } = seedRecipes();
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [soup.id] });
        expect(service.isRestoreActive()).toBe(false);
        await service.restore({ operationId: del.operationId });
        expect(service.isRestoreActive()).toBe(true);
        expect(localStore.trash_restoring_until).toBeGreaterThan(clock.t);
        clock.t += 61_000;
        expect(service.isRestoreActive()).toBe(false);
    });

    it('reports when there is nothing to restore', async () => {
        const { service } = makeService();
        const res = await service.restore({ operationId: 'nope' });
        expect(res).toMatchObject({ ok: false });
    });

    it('restores a large folder with a bounded number of progress writes', async () => {
        const big = fakeBookmarks.seed('2', 'Big');
        for (let i = 0; i < 500; i++) fakeBookmarks.seed(big.id, `B${i}`, `https://b${i}.example/`);
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [big.id] });
        const set = chrome.storage.local.set as unknown as { mock: { calls: unknown[][] } };
        const before = set.mock.calls.length;
        const res = await service.restore({ operationId: del.operationId });
        expect(res.ok).toBe(true);
        expect(fakeBookmarks.titlesIn(res.results![0].restoredTo!.rootId)).toHaveLength(500);
        const writes = set.mock.calls.length - before;
        expect(writes).toBeLessThan(40); // one checkpoint per 25 creates, not one per node
        // Progress writes stay small: never the whole snapshot.
        const biggest = Math.max(...set.mock.calls.slice(before).map(c => JSON.stringify(c[0]).length));
        expect(biggest).toBeLessThan(2000);
    });

    it('a worker killed before the first checkpoint still resumes without duplicates', async () => {
        const { folder } = seedRecipes();
        const original = shape(fakeBookmarks.tree(folder.id));
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        const entryId = del.entryIds![0];
        clock.t += 1000;
        // Two creates happen, then the worker dies: progress says restoring, created 0.
        fakeBookmarks.failAfter('create', 2, 'killed');
        await service.restore({ entryId });
        localStore[`trash_prog_${entryId}`] = { ...progressOf(entryId), state: 'restoring', created: 0 };
        clock.t += 1000;
        const fresh = makeService();
        await fresh.service.reconcile();
        clock.t += 1000;
        expect((await fresh.service.restore({ entryId })).ok).toBe(true);
        const copies = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Recipes');
        expect(copies).toHaveLength(1);
        expect(shape(copies[0])).toEqual(original);
    });

    it('Restore to... after a partial restore moves the partial copy instead of leaving it behind', async () => {
        const { folder } = seedRecipes();
        const original = shape(fakeBookmarks.tree(folder.id));
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        clock.t += 1000;
        fakeBookmarks.failAfter('create', 3, 'Boom');
        const broken = await service.restore({ operationId: del.operationId });
        expect(broken.results![0].state).toBe('failed');
        expect(fakeBookmarks.titlesIn('1')).toContain('Recipes'); // partial copy
        clock.t += 1000;
        const res = await service.restore({ operationId: del.operationId, targetParentId: '2' });
        expect(res.ok).toBe(true);
        expect(fakeBookmarks.titlesIn('1')).not.toContain('Recipes');
        const moved = fakeBookmarks.tree('2').children!.filter(c => c.title === 'Recipes');
        expect(moved).toHaveLength(1);
        expect(shape(moved[0])).toEqual(original);
    });

    it('a late retry never takes over a bookmark the user added after the failure', async () => {
        const { folder } = seedRecipes();
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        clock.t += 1000;
        fakeBookmarks.failAfter('create', 1, 'Boom'); // only the folder gets created
        await service.restore({ operationId: del.operationId });
        const partial = fakeBookmarks.tree('1').children!.find(c => c.title === 'Recipes')!;
        clock.t += 60 * 60 * 1000; // an hour later the user adds "Soup" there by hand
        const mine = await chrome.bookmarks.create({ parentId: partial.id, title: 'Soup', url: 'https://soup.example/' });
        clock.t += 1000;
        expect((await service.restore({ operationId: del.operationId })).ok).toBe(true);
        const soups = fakeBookmarks.tree(partial.id).children!.filter(c => c.title === 'Soup');
        expect(soups).toHaveLength(2); // the user's own copy plus the restored one
        expect(soups.some(c => c.id === mine.id)).toBe(true);
    });

    it('undoing a bookmark and then its deleted parent folder gives one folder, not two', async () => {
        const { folder, soup } = seedRecipes();
        const { service } = makeService();
        const op1 = await service.deleteItems({ ids: [soup.id] });
        clock.t += 1000;
        const op2 = await service.deleteItems({ ids: [folder.id] });
        clock.t += 1000;
        await service.restore({ operationId: op1.operationId }); // recreates "Recipes" holding Soup
        clock.t += 1000;
        await service.restore({ operationId: op2.operationId });
        const recipes = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Recipes');
        expect(recipes).toHaveLength(1);
        expect(recipes[0].children!.map(c => c.title).sort()).toEqual(['Cake', 'Drinks', 'Pie', 'Soup']);
    });

    it('a worker killed right after the first create (nothing checkpointed) does not duplicate', async () => {
        const { folder } = seedRecipes();
        const original = shape(fakeBookmarks.tree(folder.id));
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        const entryId = del.entryIds![0];
        clock.t += 1000;
        fakeBookmarks.failAfter('create', 1, 'killed');
        await service.restore({ entryId });
        // Model a crash before any progress write after start: no created count, no root id.
        const p = progressOf(entryId);
        localStore[`trash_prog_${entryId}`] = { entryId, state: 'restoring', updatedAt: p.updatedAt, restoreStartedAt: p.restoreStartedAt };
        clock.t += 1000;
        const fresh = makeService();
        await fresh.service.reconcile();
        clock.t += 1000;
        expect((await fresh.service.restore({ entryId })).ok).toBe(true);
        const copies = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Recipes');
        expect(copies).toHaveLength(1);
        expect(shape(copies[0])).toEqual(original);
    });

    it('never merges into a same-named folder the user created after the delete', async () => {
        const { folder } = seedRecipes();
        const { service } = makeService();
        const del = await service.deleteItems({ ids: [folder.id] });
        clock.t += 1000;
        const mine = await chrome.bookmarks.create({ parentId: '1', title: 'Recipes' });
        await chrome.bookmarks.create({ parentId: mine.id, title: 'My own', url: 'https://mine.example/' });
        clock.t += 1000;
        await service.restore({ operationId: del.operationId });
        const recipes = fakeBookmarks.tree('1').children!.filter(c => c.title === 'Recipes');
        expect(recipes).toHaveLength(2);
        expect(fakeBookmarks.titlesIn(mine.id)).toEqual(['My own']);
    });
});
