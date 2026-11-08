// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { renameNode, undoRename } from '../src/lib/rename';

describe('rename with Undo', () => {
    it('renames and Undo puts the old name back', async () => {
        const n = fakeBookmarks.seed('1', 'Old', 'https://a.example/');
        const r = await renameNode(n.id, 'New');
        expect(r).toEqual({ ok: true, record: { id: n.id, before: 'Old', after: 'New' } });
        expect(fakeBookmarks.titlesIn('1')).toEqual(['New']);
        if (!r?.ok) throw new Error('rename failed');
        expect(await undoRename(r.record)).toBe('restored');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Old']);
    });

    it('an unchanged name is not a rename', async () => {
        const n = fakeBookmarks.seed('1', 'Same');
        expect(await renameNode(n.id, 'Same')).toBeNull();
    });

    it('refuses missing items and Chrome\'s own folders', async () => {
        expect(await renameNode('999', 'X')).toEqual({ ok: false, reason: 'It no longer exists.' });
        expect(await renameNode('1', 'X')).toEqual({ ok: false, reason: "Chrome's own folders can't be renamed." });
        expect(fakeBookmarks.titlesIn('0')[0]).toBe('Bookmarks bar');
    });

    it('Undo never overwrites a newer name', async () => {
        const n = fakeBookmarks.seed('1', 'Old');
        const r = await renameNode(n.id, 'New');
        if (!r?.ok) throw new Error('rename failed');
        await chrome.bookmarks.update(n.id, { title: 'Newer' });
        expect(await undoRename(r.record)).toBe('changed');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Newer']);
    });

    it('Undo of a deleted item reports it as missing', async () => {
        const n = fakeBookmarks.seed('1', 'Old', 'https://a.example/');
        const r = await renameNode(n.id, 'New');
        if (!r?.ok) throw new Error('rename failed');
        await chrome.bookmarks.remove(n.id);
        expect(await undoRename(r.record)).toBe('missing');
    });

    it('reports an API failure as a reason', async () => {
        const n = fakeBookmarks.seed('1', 'Old');
        fakeBookmarks.failAfter('update', 0, 'Quota exceeded');
        expect(await renameNode(n.id, 'New')).toEqual({ ok: false, reason: 'Quota exceeded' });
    });
});
