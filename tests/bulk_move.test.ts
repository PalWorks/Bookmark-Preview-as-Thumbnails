// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { moveNodes, undoMoves } from '../src/lib/bulk_move';

describe('bulk move', () => {
    it('moves items to the end of the target and Undo puts them back in place', async () => {
        const a = fakeBookmarks.seed('1', 'A', 'https://a.example/');
        const b = fakeBookmarks.seed('1', 'B', 'https://b.example/');
        fakeBookmarks.seed('1', 'C', 'https://c.example/');
        const d = fakeBookmarks.seed('1', 'D', 'https://d.example/');
        const target = fakeBookmarks.seed('2', 'Target');
        fakeBookmarks.seed(target.id, 'Existing', 'https://e.example/');

        const r = await moveNodes([d.id, b.id], target.id);
        expect(r.failed).toEqual([]);
        expect(fakeBookmarks.titlesIn(target.id)).toEqual(['Existing', 'D', 'B']);
        expect(fakeBookmarks.titlesIn('1')).toEqual(['A', 'C']);

        const u = await undoMoves(r.moved);
        expect(u).toEqual({ restored: 2, missing: 0 });
        expect(fakeBookmarks.titlesIn('1')).toEqual(['A', 'B', 'C', 'D']);
        expect(a.id).toBeTruthy();
    });

    it('an item inside a selected folder moves with the folder, not on its own', async () => {
        const folder = fakeBookmarks.seed('1', 'Folder');
        const inner = fakeBookmarks.seed(folder.id, 'Inner', 'https://i.example/');
        const target = fakeBookmarks.seed('2', 'Target');
        const r = await moveNodes([folder.id, inner.id], target.id);
        expect(r.moved.map(m => m.id)).toEqual([folder.id]);
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual(['Inner']);
    });

    it('refuses a folder into itself, permanent folders and missing items, and moves the rest', async () => {
        const folder = fakeBookmarks.seed('1', 'Folder');
        const child = fakeBookmarks.seed(folder.id, 'Child');
        const ok = fakeBookmarks.seed('1', 'Ok', 'https://ok.example/');
        const r = await moveNodes([folder.id, '1', '999', ok.id], child.id);
        expect(r.moved.map(m => m.id)).toEqual([ok.id]);
        expect(r.failed.map(f => f.id).sort()).toEqual([folder.id, '1', '999'].sort());
    });

    it('Undo skips items whose original folder is gone', async () => {
        const src = fakeBookmarks.seed('1', 'Src');
        const x = fakeBookmarks.seed(src.id, 'X', 'https://x.example/');
        const target = fakeBookmarks.seed('2', 'Target');
        const r = await moveNodes([x.id], target.id);
        await chrome.bookmarks.removeTree(src.id);
        expect(await undoMoves(r.moved)).toEqual({ restored: 0, missing: 1 });
    });

    it('a missing target fails everything', async () => {
        const x = fakeBookmarks.seed('1', 'X', 'https://x.example/');
        const r = await moveNodes([x.id], '404');
        expect(r.moved).toEqual([]);
        expect(r.failed).toHaveLength(1);
    });
});
