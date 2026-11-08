// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore, EXTENSION_ORIGIN } from './setup';
import { createFolderPrefsService, handleFolderPrefsMessage } from '../src/sw/folder_prefs';
import {
    readFolderPrefs, applyFolderPrefPatch, sanitizeFolderPrefPatch, isInHiddenFolder, buildParentMap,
} from '../src/lib/folder_prefs';

const page = { url: `${EXTENSION_ORIGIN}index.html` } as chrome.runtime.MessageSender;

describe('folder prefs', () => {
    it('sets and clears fields independently and broadcasts the change', async () => {
        const f = fakeBookmarks.seed('1', 'Tools');
        const broadcast = vi.fn();
        const svc = createFolderPrefsService({ broadcast });
        await svc.set([f.id], { color: 'red' });
        await svc.set([f.id], { hideFromSearch: true });
        expect(localStore[`fpref_${f.id}`]).toEqual({ color: 'red', hideFromSearch: true });
        await svc.set([f.id], { color: null });
        expect(localStore[`fpref_${f.id}`]).toEqual({ hideFromSearch: true });
        await svc.set([f.id], { hideFromSearch: false });
        expect(localStore[`fpref_${f.id}`]).toBeUndefined();
        expect(broadcast).toHaveBeenCalledWith({ type: 'FOLDER_PREFS_CHANGED', ids: [f.id] });
    });

    it('two concurrent changes to one folder both survive (single writer)', async () => {
        const f = fakeBookmarks.seed('1', 'Tools');
        const svc = createFolderPrefsService({ broadcast: vi.fn() });
        await Promise.all([svc.set([f.id], { color: 'teal' }), svc.set([f.id], { hideFromSearch: true })]);
        expect(localStore[`fpref_${f.id}`]).toEqual({ color: 'teal', hideFromSearch: true });
    });

    it('skips bookmarks, missing ids and the root', async () => {
        const b = fakeBookmarks.seed('1', 'Link', 'https://x.example/');
        const svc = createFolderPrefsService({ broadcast: vi.fn() });
        const r = await svc.set([b.id, '404', '0'], { color: 'red' });
        expect(r.changed).toEqual([]);
        expect(r.skipped).toEqual([b.id, '404', '0']);
    });

    it('prunes prefs of folders that no longer exist', async () => {
        const f = fakeBookmarks.seed('1', 'Gone');
        const keep = fakeBookmarks.seed('1', 'Kept');
        localStore[`fpref_${f.id}`] = { color: 'red' };
        localStore[`fpref_${keep.id}`] = { color: 'blue' };
        await chrome.bookmarks.removeTree(f.id);
        const svc = createFolderPrefsService({ broadcast: vi.fn() });
        expect(await svc.prune()).toBe(1);
        expect(await readFolderPrefs()).toEqual({ [keep.id]: { color: 'blue' } });
    });

    it('applySnapshot does not overwrite prefs set meanwhile', async () => {
        const f = fakeBookmarks.seed('1', 'New');
        localStore[`fpref_${f.id}`] = { color: 'green' };
        const svc = createFolderPrefsService({ broadcast: vi.fn() });
        await svc.applySnapshot([{ newId: f.id, pref: { color: 'red' } }]);
        expect(localStore[`fpref_${f.id}`]).toEqual({ color: 'green' });
    });

    it('rejects messages from web pages and invalid patches', async () => {
        const f = fakeBookmarks.seed('1', 'Tools');
        const svc = createFolderPrefsService({ broadcast: vi.fn() });
        expect(await handleFolderPrefsMessage(svc, { ids: [f.id], patch: { color: 'red' } }, { url: 'https://evil.example/' } as never))
            .toMatchObject({ ok: false });
        expect(await handleFolderPrefsMessage(svc, { ids: [f.id], patch: { color: 'chartreuse' } }, page)).toMatchObject({ ok: false });
        expect(await handleFolderPrefsMessage(svc, { ids: [], patch: { color: 'red' } }, page)).toMatchObject({ ok: false });
        expect(await handleFolderPrefsMessage(svc, { ids: [f.id], patch: { color: 'red', evil: 1 } }, page)).toMatchObject({ ok: true });
        expect(localStore[`fpref_${f.id}`]).toEqual({ color: 'red' });
    });

    it('pure helpers', () => {
        expect(applyFolderPrefPatch(undefined, { hideFromSearch: false })).toBeUndefined();
        expect(sanitizeFolderPrefPatch({})).toBeUndefined();
        const parentOf = new Map([['c', 'b'], ['b', 'a'], ['a', '1']]);
        const hidden = new Set(['a']);
        expect(isInHiddenFolder('c', parentOf, hidden)).toBe(true);
        expect(isInHiddenFolder('1', parentOf, hidden)).toBe(false);
        const map = buildParentMap([{ id: '1', parentId: '0', title: '', syncing: false, children: [{ id: '5', parentId: '1', title: 'x', syncing: false }] }]);
        expect(map.get('5')).toBe('1');
    });
});

describe('folder prefs prune and pending Trash captures', () => {
    it('keeps prefs of folders whose delete is still buffered', async () => {
        const f = fakeBookmarks.seed('1', 'Buffered');
        localStore[`fpref_${f.id}`] = { color: 'red' };
        await chrome.bookmarks.removeTree(f.id);
        const svc = createFolderPrefsService({ broadcast: vi.fn() });
        expect(await svc.prune(new Set([f.id]))).toBe(0);
        expect(localStore[`fpref_${f.id}`]).toEqual({ color: 'red' });
    });
});
