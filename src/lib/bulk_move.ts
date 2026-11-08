// SPDX-License-Identifier: AGPL-3.0-only
//
// Move several bookmarks and folders into one folder, with an Undo that puts them
// back. Runs in the page; DOM-free so it can be unit tested. Every original
// position is recorded before the first move, so Undo does not depend on the order
// things were moved in. Closing the page mid-move leaves the moves made so far.
// Undo leaves alone anything that was moved again since (here, in Chrome's manager
// or by sync), so it never undoes a newer change. Also used for Cut and Paste.

import { getAncestors, getNode, isManaged, isPermanent, type BookmarkNode } from './bookmark_tree';

export interface MoveRecord {
    id: string;
    title: string;
    parentId: string;
    index: number;
    /** The folder it was moved to. */
    to: string;
}

export interface MoveResult {
    moved: MoveRecord[];
    /** Title of the destination folder, read before moving (for the toast). */
    targetTitle?: string;
    /** Items that could not be moved, with a short reason. */
    failed: Array<{ id: string; title: string; reason: string }>;
}

export interface UndoMoveResult {
    restored: number;
    /** Items that are gone, or whose original folder is gone. */
    missing: number;
    /** Items moved again since, left where they are now. */
    changed: number;
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Move `ids` (in this order) to the end of `targetId`. Items inside another
 * selected folder travel with that folder and are not moved on their own.
 */
export async function moveNodes(ids: string[], targetId: string): Promise<MoveResult> {
    const failed: MoveResult['failed'] = [];
    const target = await getNode(targetId);
    if (!target || target.url || isManaged(target)) {
        return { moved: [], failed: ids.map(id => ({ id, title: '', reason: 'That folder is no longer available.' })) };
    }
    const targetChain = new Set((await getAncestors(target)).map(n => n.id).concat(target.id));

    const nodes: BookmarkNode[] = [];
    for (const id of [...new Set(ids)]) {
        const n = await getNode(id);
        if (!n) { failed.push({ id, title: '', reason: 'It no longer exists.' }); continue; }
        nodes.push(n);
    }
    // Only folders that will actually move can carry their contents along.
    const selected = new Set(nodes.filter(n => !isPermanent(n) && !isManaged(n)).map(n => n.id));
    const cache = new Map<string, BookmarkNode | undefined>();
    const roots: BookmarkNode[] = [];
    for (const n of nodes) {
        const chain = await getAncestors(n, cache);
        if (chain.some(a => selected.has(a.id))) continue; // moves with its selected folder
        if (isPermanent(n)) { failed.push({ id: n.id, title: n.title, reason: "Chrome's own folders can't be moved." }); continue; }
        if (isManaged(n)) { failed.push({ id: n.id, title: n.title, reason: 'Managed by your organisation.' }); continue; }
        if (!n.url && targetChain.has(n.id)) { failed.push({ id: n.id, title: n.title, reason: "A folder can't go inside itself." }); continue; }
        roots.push(n);
    }

    // Record every original position first.
    const records: MoveRecord[] = roots.map(n => ({ id: n.id, title: n.title, parentId: n.parentId ?? '', index: n.index ?? 0, to: targetId }));
    const moved: MoveRecord[] = [];
    for (const r of records) {
        try {
            await chrome.bookmarks.move(r.id, { parentId: targetId });
            moved.push(r);
        } catch (err) {
            failed.push({ id: r.id, title: r.title, reason: message(err) });
        }
    }
    return { moved, failed, targetTitle: target.title };
}

/** Put moved items back: per original folder, lowest original position first. */
export async function undoMoves(records: MoveRecord[]): Promise<UndoMoveResult> {
    const ordered = [...records].sort((a, b) => a.parentId.localeCompare(b.parentId) || a.index - b.index);
    let restored = 0;
    let missing = 0;
    let changed = 0;
    // Earlier items of the same folder that stay away shift the later ones up.
    const skipped = new Map<string, number>();
    const skip = (r: MoveRecord) => skipped.set(r.parentId, (skipped.get(r.parentId) ?? 0) + 1);
    for (const r of ordered) {
        const [node, parent] = await Promise.all([getNode(r.id), getNode(r.parentId)]);
        if (!node || !parent || parent.url) { missing++; skip(r); continue; }
        if (node.parentId !== r.to) { changed++; skip(r); continue; }
        try {
            const count = (await chrome.bookmarks.getChildren(r.parentId)).length;
            const index = Math.max(0, r.index - (skipped.get(r.parentId) ?? 0));
            await chrome.bookmarks.move(r.id, { parentId: r.parentId, index: Math.min(index, count) });
            restored++;
        } catch {
            missing++;
            skip(r);
        }
    }
    return { restored, missing, changed };
}
