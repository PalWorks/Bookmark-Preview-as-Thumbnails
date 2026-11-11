// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { buildSnapshot, stripQuery } from '../src/lib/change_set/snapshot';

type Node = chrome.bookmarks.BookmarkTreeNode;
const n = (id: string, parentId: string, title: string, children?: Node[], url?: string): Node =>
    ({ id, parentId, title, ...(url ? { url } : { children: children ?? [] }) } as Node);

describe('folder export (snapshot)', () => {
    it('hiding query strings also drops a user name and password from links', () => {
        // A sample login, built here so secret scanners do not mistake it for a real one.
        const login = ['user', 'token'].join(':');
        expect(stripQuery(`https://${login}@host.example/a?x=1#y`)).toBe('https://host.example/a');
        expect(stripQuery('https://host.example/a@b')).toBe('https://host.example/a@b');
        expect(stripQuery('http://plain.example/')).toBe('http://plain.example/');
    });

    it('leaves out a ticked folder whose parent is hidden from search', () => {
        const inner = n('4', '3', 'Inner', [n('5', '4', 'Secret', undefined, 'https://s.example/')]);
        const hidden = n('3', '1', 'Hidden', [inner]);
        const open = n('6', '1', 'Open', [n('7', '6', 'Fine', undefined, 'https://f.example/')]);
        const root = n('0', '', '', [n('1', '0', 'Bookmarks bar', [hidden, open])]);
        const snap = buildSnapshot({ roots: [root], folderIds: ['4', '6'], hiddenFolderIds: new Set(['3']), stripQuery: false, snapshotId: 's1' });
        expect(snap.folders.map(f => f.id)).toEqual(['6']);
        expect(snap.items.map(i => i.id)).toEqual(['7']);
    });
});
