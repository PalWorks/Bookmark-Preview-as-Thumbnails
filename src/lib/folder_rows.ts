// SPDX-License-Identifier: AGPL-3.0-only
// Flattened folder list for tick-box pickers; folders hidden from search are left out.

type Node = chrome.bookmarks.BookmarkTreeNode;

export interface FolderRow { id: string; title: string; depth: number; count: number }

export function folderRows(roots: Node[], hidden: Set<string>): FolderRow[] {
    const rows: FolderRow[] = [];
    const count = (n: Node): number => (n.children ?? []).reduce((s, c) => s + (c.url ? 1 : count(c)), 0);
    const walk = (n: Node, depth: number) => {
        if (n.url || hidden.has(n.id)) return;
        if (n.id !== '0') rows.push({ id: n.id, title: n.title || '(untitled)', depth, count: count(n) });
        (n.children ?? []).forEach(c => walk(c, n.id === '0' ? 0 : depth + 1));
    };
    roots.forEach(r => walk(r, 0));
    return rows;
}

