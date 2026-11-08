// SPDX-License-Identifier: AGPL-3.0-only
//
// Rename a bookmark or folder with an Undo that puts the old name back. DOM-free
// so it can be unit tested. Undo changes nothing when the item was renamed again
// (here, in Chrome's manager or by sync) or is gone, so it never overwrites a
// newer name. Like bulk move (DECISIONS D14, D15), the Undo lives in the page.

import { getNode, isManaged, isPermanent } from './bookmark_tree';

export interface RenameRecord {
    id: string;
    before: string;
    after: string;
}

export type RenameResult =
    | { ok: true; record: RenameRecord }
    | { ok: false; reason: string };

export type UndoRenameResult = 'restored' | 'changed' | 'missing';

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Rename `id` to `title`; `null` record when the name did not change. */
export async function renameNode(id: string, title: string): Promise<RenameResult | null> {
    const node = await getNode(id);
    if (!node) return { ok: false, reason: 'It no longer exists.' };
    if (isPermanent(node)) return { ok: false, reason: "Chrome's own folders can't be renamed." };
    if (isManaged(node)) return { ok: false, reason: 'Managed by your organisation.' };
    if (node.title === title) return null;
    try {
        await chrome.bookmarks.update(id, { title });
    } catch (err) {
        return { ok: false, reason: message(err) };
    }
    return { ok: true, record: { id, before: node.title, after: title } };
}

/** Put the old name back, only if the item still carries the name we gave it. */
export async function undoRename(r: RenameRecord): Promise<UndoRenameResult> {
    const node = await getNode(r.id);
    if (!node) return 'missing';
    if (node.title !== r.after) return 'changed';
    try {
        await chrome.bookmarks.update(r.id, { title: r.before });
    } catch {
        return 'missing';
    }
    return 'restored';
}
