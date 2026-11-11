// SPDX-License-Identifier: AGPL-3.0-only
//
// Export chosen folders for an AI (docs/designs/agent-bridge.md, Stage 1.1). Only
// the folders the user ticked go out; folders hidden from search never do. No
// image bytes. DOM-free.

import { CHANGES_FORMAT, MAX_OPS, SNAPSHOT_FORMAT, FORMAT_VERSION } from './format';

type Node = chrome.bookmarks.BookmarkTreeNode;

export interface SnapshotItem {
    id: string;
    parentId: string;
    index: number;
    title: string;
    url?: string;
    tags?: string[];
    rating?: number;
}

export interface Snapshot {
    format: typeof SNAPSHOT_FORMAT;
    v: number;
    snapshotId: string;
    createdAt: string;
    folders: Array<{ id: string; path: string; count: number }>;
    items: SnapshotItem[];
}

export interface SnapshotOptions {
    roots: Node[];
    /** Folders the user ticked. A ticked folder includes everything below it. */
    folderIds: string[];
    hiddenFolderIds: Set<string>;
    stripQuery: boolean;
    snapshotId: string;
    meta?: Record<string, { tags?: string[]; rating?: number }>;
    now?: Date;
}

/** Drop everything after ? or #, and any user name or password, keeping the address readable. */
export function stripQuery(url: string): string {
    const cut = url.search(/[?#]/);
    const base = cut < 0 ? url : url.slice(0, cut);
    // https://user:token@host/... would otherwise keep its credentials.
    return base.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

export function buildSnapshot(o: SnapshotOptions): Snapshot {
    const byId = new Map<string, Node>();
    const pathOf = new Map<string, string>();
    const walk = (n: Node, path: string[]) => {
        byId.set(n.id, n);
        const p = n.parentId && n.parentId !== '0' ? [...path, n.title] : n.id === '0' ? [] : [n.title];
        pathOf.set(n.id, p.join(' / '));
        (n.children ?? []).forEach(c => walk(c, n.id === '0' ? [] : p));
    };
    o.roots.forEach(r => walk(r, []));

    // A folder hidden from search hides everything under it, as in the bridge's scope check.
    const underHidden = (id: string) => {
        for (let p: string | undefined = id; p && p !== '0'; p = byId.get(p)?.parentId) if (o.hiddenFolderIds.has(p)) return true;
        return false;
    };
    const chosen = new Set(o.folderIds.filter(id => byId.has(id) && !underHidden(id)));
    // A folder inside another ticked folder is already covered.
    const isCovered = (id: string) => {
        let p = byId.get(id)?.parentId;
        while (p && p !== '0') { if (chosen.has(p)) return true; p = byId.get(p)?.parentId; }
        return false;
    };
    const tops = [...chosen].filter(id => !isCovered(id));

    const folders: Snapshot['folders'] = [];
    const items: SnapshotItem[] = [];
    const visit = (n: Node) => {
        if (!n.url && o.hiddenFolderIds.has(n.id)) return;
        (n.children ?? []).forEach((c, index) => {
            if (!c.url && o.hiddenFolderIds.has(c.id)) return;
            const item: SnapshotItem = { id: c.id, parentId: n.id, index, title: c.title ?? '' };
            if (c.url) {
                item.url = o.stripQuery ? stripQuery(c.url) : c.url;
                const m = o.meta?.[c.url];
                if (m?.tags?.length) item.tags = m.tags;
                if (m?.rating) item.rating = m.rating;
            }
            items.push(item);
            if (!c.url) visit(c);
        });
    };
    for (const id of tops) {
        const f = byId.get(id)!;
        folders.push({ id, path: pathOf.get(id) ?? f.title, count: 0 });
        const start = items.length;
        visit(f);
        folders[folders.length - 1].count = items.length - start;
    }
    return {
        format: SNAPSHOT_FORMAT,
        v: FORMAT_VERSION,
        snapshotId: o.snapshotId,
        createdAt: (o.now ?? new Date()).toISOString(),
        folders,
        items,
    };
}

/** The instructions that go with the snapshot, so any chat AI can answer in our format. */
export function instructionsFor(goal: string): string {
    const task = goal.trim() || 'Tidy these bookmarks: group related links into clear folders, give unclear titles plain names, and suggest dead or duplicate links for Trash.';
    return [
        'You are helping organise my browser bookmarks. My request:',
        task,
        '',
        'Below is a JSON export of the folders I chose. Answer with ONE JSON object only, no other text, in this format:',
        `{"format":"${CHANGES_FORMAT}","v":1,"snapshotId":"<copy snapshotId from the export>","title":"<short summary>","ops":[ ... ]}`,
        '',
        'Allowed changes in "ops" (use the ids from the export):',
        '{"op":"create_folder","tempId":"new:1","parentId":"<folder id or new:N>","title":"..."}',
        '{"op":"move","id":"<id>","parentId":"<folder id or new:N>","index":0}   (index is optional)',
        '{"op":"rename","id":"<id>","title":"..."}',
        '{"op":"set_tags","id":"<bookmark id>","tags":["..."]}   (replaces its tags; at most 20, each up to 40 characters)',
        '{"op":"set_rating","id":"<bookmark id>","rating":1}   (1 to 5, or null to clear)',
        '{"op":"trash","id":"<id>"}   (moves it to Trash, which I can undo)',
        '',
        'Rules: only ids from the export; each item at most once per kind of change; an item sent to Trash gets no other change;',
        `create a folder before moving into it; never change the top-level folders; at most ${MAX_OPS} changes.`,
        'I will review every change before anything happens.',
    ].join('\n');
}
