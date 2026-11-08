// SPDX-License-Identifier: AGPL-3.0-only
// Deletes made outside this extension (Chrome's manager, sync) go to Trash too.
import { describe, it, expect, vi } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore, syncStore } from './setup';
import { makeService, entries, progressOf, seedRecipes, shape } from './trash_helpers';
import { createTrashService } from '../src/sw/trash';

/** A worker with the onRemoved listener wired like sw.ts. */
type ApplyPrefs = (map: Array<{ newId: string; pref: unknown }>) => Promise<void>;
function makeWired(opts: { applyFolderPrefs?: ApplyPrefs } = {}) {
    const made = opts.applyFolderPrefs
        ? (() => {
            let n = 0;
            const service = createTrashService({ uuid: () => `x-${++n}`, broadcast: vi.fn(), applyFolderPrefs: opts.applyFolderPrefs });
            return { service };
        })()
        : makeService();
    const listener = (id: string, info: unknown) => made.service.noteRemoved(id, info as never);
    fakeBookmarks.onRemoved.addListener(listener as never);
    return made.service;
}

const external = () => entries().filter(e => e.origin === 'external');

describe('external deletes', () => {
    it('records a folder removed in Chrome as one entry with its subtree, ancestry and scope', async () => {
        const { folder } = seedRecipes();
        const service = makeWired();
        await chrome.bookmarks.removeTree(folder.id);
        await service.flushExternal();

        const [entry] = external();
        expect(entry).toBeDefined();
        expect(entry.title).toBe('Recipes');
        expect(entry.bookmarkCount).toBe(4);
        expect(entry.parentId).toBe('1');
        expect(entry.index).toBe(1);
        expect(entry.ancestors).toEqual([{ oldId: '1', title: 'Bookmarks bar' }]);
        expect(entry.scope).toMatchObject({ rootId: '1', folderType: 'bookmarks-bar', syncing: false });
        expect(progressOf(entry.entryId).state).toBe('deleted');
    });

    it('a burst becomes one operation; restore puts sequential removals back in order', async () => {
        const { folder, soup, cake, pie } = seedRecipes();
        const service = makeWired();
        const before = (await chrome.bookmarks.getChildren(folder.id)).map(c => c.title);
        // Chrome's manager deleting three items one after another (indexes shift each time).
        await chrome.bookmarks.remove(soup.id);
        await chrome.bookmarks.remove(cake.id);
        await chrome.bookmarks.remove(pie.id);
        await service.flushExternal();

        const ext = external();
        expect(ext).toHaveLength(3);
        expect(new Set(ext.map(e => e.operationId)).size).toBe(1);

        const res = await service.restore({ operationId: ext[0].operationId });
        expect(res.ok).toBe(true);
        expect((await chrome.bookmarks.getChildren(folder.id)).map(c => c.title)).toEqual(before);
    });

    it('does not record the extension\'s own deletes', async () => {
        const { folder } = seedRecipes();
        const service = makeWired();
        await service.deleteItems({ ids: [folder.id] });
        await service.flushExternal();
        expect(entries()).toHaveLength(1);
        expect(external()).toHaveLength(0);
    });

    it('does not record an own delete whose event reaches a restarted worker', async () => {
        const { soup } = seedRecipes();
        const first = makeService().service;
        await first.deleteItems({ ids: [soup.id] });
        // A fresh worker (empty memory) gets a late event for the same id.
        const fresh = makeService().service;
        const entry = entries()[0];
        fresh.noteRemoved(soup.id, { parentId: entry.parentId, index: entry.index, node: { id: soup.id, title: 'Soup', url: 'https://soup.example/' } as never });
        await fresh.flushExternal();
        expect(external()).toHaveLength(0);
    });

    it('children removed before their folder (bottom-up sync) are kept inside the folder', async () => {
        const { folder, sub } = seedRecipes();
        const original = shape((await chrome.bookmarks.getSubTree(folder.id))[0]);
        const service = makeWired();
        // Sync removing leaves first, then the emptied folders.
        for (const child of await chrome.bookmarks.getChildren(sub.id)) await chrome.bookmarks.remove(child.id);
        await chrome.bookmarks.remove(sub.id);
        for (const child of await chrome.bookmarks.getChildren(folder.id)) await chrome.bookmarks.remove(child.id);
        await chrome.bookmarks.remove(folder.id);
        await service.flushExternal();

        const ext = external();
        expect(ext).toHaveLength(1);
        expect(ext[0].title).toBe('Recipes');
        expect(ext[0].bookmarkCount).toBe(4);

        await service.restore({ operationId: ext[0].operationId });
        const recipes = (await chrome.bookmarks.getChildren('1')).find(c => c.title === 'Recipes')!;
        expect(shape((await chrome.bookmarks.getSubTree(recipes.id))[0])).toEqual(original);
    });

    it('skips a node whose parent was already gone when the event arrived (sign-out shape)', async () => {
        const service = makeService().service;
        service.noteRemoved('999', { parentId: '998', index: 0, node: { id: '999', title: 'Account item', url: 'https://acct.example/' } as never });
        await service.flushExternal();
        expect(entries()).toHaveLength(0);
    });

    it('skips permanent folders and events without a node', async () => {
        const service = makeService().service;
        service.noteRemoved('1', { parentId: '0', index: 0, node: { id: '1', title: 'Bookmarks bar', children: [] } as never });
        service.noteRemoved('500', { parentId: '1', index: 0 });
        await service.flushExternal();
        expect(entries()).toHaveLength(0);
    });

    it('records nothing when the setting is off', async () => {
        const { soup } = seedRecipes();
        syncStore.trashExternal = false;
        const service = makeWired();
        await chrome.bookmarks.remove(soup.id);
        await service.flushExternal();
        expect(entries()).toHaveLength(0);
    });

    it('waits 3 seconds of quiet before writing, then writes once', async () => {
        vi.useFakeTimers();
        try {
            const { soup, cake } = seedRecipes();
            const service = makeWired();
            const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
            await chrome.bookmarks.remove(soup.id);
            await vi.advanceTimersByTimeAsync(2000);
            await chrome.bookmarks.remove(cake.id);
            await vi.advanceTimersByTimeAsync(2000);
            expect(external()).toHaveLength(0);
            const writesBefore = set.mock.calls.length;
            await vi.advanceTimersByTimeAsync(1500);
            await service.flushExternal();
            expect(external()).toHaveLength(2);
            expect(new Set(external().map(e => e.operationId)).size).toBe(1);
            expect(set.mock.calls.length - writesBefore).toBeLessThanOrEqual(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('restoring a bookmark that already came back (another device) does not duplicate it', async () => {
        const { soup, folder } = seedRecipes();
        const service = makeWired();
        await chrome.bookmarks.remove(soup.id);
        await service.flushExternal();
        // Sync brings it back before the user presses Restore here.
        await chrome.bookmarks.create({ parentId: folder.id, title: 'Soup', url: 'https://soup.example/', index: 0 });
        const res = await service.restore({ operationId: external()[0].operationId });
        expect(res.ok).toBe(true);
        expect((await chrome.bookmarks.search({ url: 'https://soup.example/' }))).toHaveLength(1);
    });

    it('carries folder colours through an external delete and restore', async () => {
        const { folder, sub } = seedRecipes();
        localStore[`fpref_${folder.id}`] = { color: 'red' };
        localStore[`fpref_${sub.id}`] = { hideFromSearch: true };
        const applyFolderPrefs = vi.fn<ApplyPrefs>(async () => undefined);
        const service = makeWired({ applyFolderPrefs });
        await chrome.bookmarks.removeTree(folder.id);
        await service.flushExternal();
        const [entry] = external();
        expect(entry.folderPrefs).toEqual({ [folder.id]: { color: 'red' }, [sub.id]: { hideFromSearch: true } });

        await service.restore({ operationId: entry.operationId });
        const map = applyFolderPrefs.mock.calls[0][0];
        const recipes = (await chrome.bookmarks.getChildren('1')).find(c => c.title === 'Recipes')!;
        const drinks = (await chrome.bookmarks.getChildren(recipes.id)).find(c => c.title === 'Drinks')!;
        expect(map).toEqual(expect.arrayContaining([
            { newId: recipes.id, pref: { color: 'red' } },
            { newId: drinks.id, pref: { hideFromSearch: true } },
        ]));
    });

    it('an extension delete also saves folder prefs', async () => {
        const { folder } = seedRecipes();
        localStore[`fpref_${folder.id}`] = { color: 'blue' };
        const service = makeService().service;
        await service.deleteItems({ ids: [folder.id] });
        expect(entries()[0].folderPrefs).toEqual({ [folder.id]: { color: 'blue' } });
    });

    it('a large own delete creates no external entries', async () => {
        const folder = fakeBookmarks.seed('1', 'Big');
        const ids: string[] = [];
        for (let i = 0; i < 300; i++) ids.push(fakeBookmarks.seed(folder.id, `B${i}`, `https://b${i}.example/`).id);
        const service = makeWired();
        const res = await service.deleteItems({ ids });
        await service.flushExternal();
        expect(res.removedRoots).toBe(300);
        expect(external()).toHaveLength(0);
    });
});
