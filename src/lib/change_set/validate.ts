// SPDX-License-Identifier: AGPL-3.0-only
//
// Validate a change set against the current bookmark tree by simulating it on a
// working copy (docs/designs/agent-bridge.md, Stage 1.3). Pure: takes the tree,
// returns a verdict per change plus the baseline each change will be checked
// against at apply time. One refused change refuses the whole set.

import {
    APPLY_ORDER, MAX_IMPACT_NODES, MAX_TAGS, MAX_TAG_LENGTH, MAX_TITLE, isTempId,
    type ChangeOp, type ChangeSetInput,
} from './format';

type TreeNode = chrome.bookmarks.BookmarkTreeNode;

export interface OpBaseline {
    /** move, trash: where it was. */
    parentId?: string;
    index?: number;
    /** rename: its title; create_folder: the parent's title (for display). */
    title?: string;
    /** set_tags, set_rating, trash of a bookmark: its URL. */
    url?: string;
    /** trash: every node id in the subtree at validation (frozen). */
    descendantIds?: string[];
}

export interface OpVerdict {
    /** Position in the set as sent. */
    n: number;
    ok: boolean;
    reason?: string;
    baseline?: OpBaseline;
    /** Indexes of changes this one needs (a move into a new folder needs its create_folder). */
    dependsOn?: number[];
}

export interface Validation {
    ok: boolean;
    verdicts: OpVerdict[];
    /** Change indexes in apply order. */
    order: number[];
    /** Nodes a Trash of this set would remove, descendants included. */
    impact: number;
}

export interface ValidateContext {
    roots: TreeNode[];
    /** Folders hidden from search (their contents are out of reach too). */
    hiddenFolderIds: Set<string>;
    /** When the set answers an export: only these folders (and their contents) may be touched. */
    scopeFolderIds?: Set<string>;
    /** 1b: the kinds this build accepts. Others are refused with a plain reason. */
    allowedKinds?: Set<ChangeOp['op']>;
}

interface WNode {
    id: string;
    parentId?: string;
    title: string;
    url?: string;
    children: string[];
    permanent: boolean;
    managed: boolean;
}

function buildWorkingCopy(roots: TreeNode[]): Map<string, WNode> {
    const map = new Map<string, WNode>();
    const walk = (n: TreeNode) => {
        map.set(n.id, {
            id: n.id,
            parentId: n.parentId,
            title: n.title ?? '',
            url: n.url,
            children: (n.children ?? []).map(c => c.id),
            permanent: !n.parentId || n.parentId === '0',
            managed: n.unmodifiable === 'managed',
        });
        (n.children ?? []).forEach(walk);
    };
    roots.forEach(walk);
    return map;
}

export function validateChangeSet(set: ChangeSetInput, ctx: ValidateContext): Validation {
    const w = buildWorkingCopy(ctx.roots);
    // Positions before any change: Undo restores in ascending original position.
    const originalIndex = new Map<string, number>();
    for (const node of w.values()) node.children.forEach((c, i) => originalIndex.set(c, i));
    const verdicts: OpVerdict[] = set.ops.map((_, n) => ({ n, ok: true }));
    const refuse = (n: number, reason: string) => {
        if (verdicts[n].ok) { verdicts[n].ok = false; verdicts[n].reason = reason; }
    };

    const ancestors = (id: string): string[] => {
        const out: string[] = [];
        let p = w.get(id)?.parentId;
        let guard = 0;
        while (p && p !== '0' && guard++ < 512) { out.push(p); p = w.get(p)?.parentId; }
        return out;
    };
    const hiddenOrAbove = (id: string) => ctx.hiddenFolderIds.has(id) || ancestors(id).some(a => ctx.hiddenFolderIds.has(a));
    const inScope = (id: string) => {
        if (!ctx.scopeFolderIds) return true;
        return ctx.scopeFolderIds.has(id) || ancestors(id).some(a => ctx.scopeFolderIds!.has(a));
    };
    const subtreeIds = (id: string): string[] => {
        const out: string[] = [];
        const stack = [id];
        while (stack.length) {
            const cur = stack.pop()!;
            out.push(cur);
            stack.push(...(w.get(cur)?.children ?? []));
        }
        return out;
    };
    const anyManaged = (id: string) => subtreeIds(id).some(x => w.get(x)?.managed);

    // An unknown id, a hidden one and one outside the export all read the same, so
    // the reason never confirms that something exists.
    const UNKNOWN = 'Unknown id, or outside the folders you shared.';
    const reachable = (id: string) => w.has(id) && w.get(id)!.id !== '0' && !hiddenOrAbove(id) && inScope(id);

    // Per-kind uniqueness and the Trash-exclusive rule (Stage 1.3).
    const seen = new Map<string, number>();
    const trashed = new Set<string>();
    set.ops.forEach((op, n) => {
        if (op.op === 'trash') trashed.add(op.id);
        const key = `${op.op}|${op.op === 'create_folder' ? op.tempId : op.id}`;
        if (seen.has(key)) refuse(n, op.op === 'create_folder' ? `${op.tempId} is created twice.` : 'The same item appears twice in this kind of change.');
        else seen.set(key, n);
        if (ctx.allowedKinds && !ctx.allowedKinds.has(op.op)) refuse(n, `"${op.op}" is not available in this version yet.`);
    });
    set.ops.forEach((op, n) => {
        if (op.op !== 'trash' && op.op !== 'create_folder' && trashed.has(op.id)) refuse(n, 'This item also goes to Trash in this set, so it cannot be changed too.');
    });

    // Temporary ids: declared once, used only as a parent, never before their create.
    const tempDeclaredAt = new Map<string, number>();
    set.ops.forEach((op, n) => { if (op.op === 'create_folder' && !tempDeclaredAt.has(op.tempId)) tempDeclaredAt.set(op.tempId, n); });
    set.ops.forEach((op, n) => {
        if (op.op === 'create_folder' || op.op === 'move') return;
        if (isTempId(op.id)) refuse(n, 'A new folder can only be a parent; its title comes from create_folder.');
    });

    // Apply order: kinds in APPLY_ORDER, the sent order within a kind.
    const order: number[] = [];
    for (const kind of APPLY_ORDER) set.ops.forEach((op, n) => { if (op.op === kind) order.push(n); });

    const tempToReal = new Map<string, string>(); // tempId -> working-copy id
    const resolve = (id: string) => (isTempId(id) ? tempToReal.get(id) : id);
    const trashedFolders = new Set(set.ops.filter(o => o.op === 'trash').map(o => (o as { id: string }).id));
    let impact = 0;
    const createdBy = new Map<string, number>(); // working-copy id -> create op index

    for (const n of order) {
        const op = set.ops[n];
        const v = verdicts[n];
        if (!v.ok) continue;
        switch (op.op) {
            case 'create_folder': {
                if (!op.title) { refuse(n, 'A new folder needs a title.'); break; }
                if (op.title.length > MAX_TITLE) { refuse(n, `Titles can be at most ${MAX_TITLE} characters.`); break; }
                if (isTempId(op.parentId)) {
                    const at = tempDeclaredAt.get(op.parentId);
                    if (at === undefined) { refuse(n, `${op.parentId} is never created in this set.`); break; }
                    if (at >= n) { refuse(n, `${op.parentId} is used before its create_folder.`); break; }
                }
                const parent = resolve(op.parentId);
                const pn = parent ? w.get(parent) : undefined;
                if (!pn || pn.url || (!isTempId(op.parentId) && !reachable(parent!))) { refuse(n, isTempId(op.parentId) ? `${op.parentId} could not be created.` : UNKNOWN); break; }
                if (pn.managed) { refuse(n, 'That folder is managed by your organisation.'); break; }
                if (trashedFolders.has(op.parentId)) { refuse(n, 'The parent folder goes to Trash in this set.'); break; }
                const id = `__${op.tempId}`;
                w.set(id, { id, parentId: pn.id, title: op.title, children: [], permanent: false, managed: false });
                pn.children.push(id);
                tempToReal.set(op.tempId, id);
                createdBy.set(id, n);
                v.baseline = { title: pn.title };
                if (isTempId(op.parentId)) v.dependsOn = [tempDeclaredAt.get(op.parentId)!];
                break;
            }
            case 'move': {
                if (!reachable(op.id)) { refuse(n, UNKNOWN); break; }
                const node = w.get(op.id)!;
                if (node.permanent) { refuse(n, "Chrome's own folders can't be moved."); break; }
                if (anyManaged(op.id)) { refuse(n, 'Managed by your organisation.'); break; }
                if (isTempId(op.parentId)) {
                    const at = tempDeclaredAt.get(op.parentId);
                    if (at === undefined) { refuse(n, `${op.parentId} is never created in this set.`); break; }
                    if (!verdicts[at].ok) { refuse(n, `${op.parentId} could not be created.`); break; }
                    v.dependsOn = [at];
                }
                const target = resolve(op.parentId);
                const tn = target ? w.get(target) : undefined;
                if (!tn || tn.url || (!isTempId(op.parentId) && !reachable(target!))) { refuse(n, isTempId(op.parentId) ? `${op.parentId} could not be created.` : 'Unknown target folder, or outside the folders you shared.'); break; }
                if (tn.managed) { refuse(n, 'That folder is managed by your organisation.'); break; }
                if (trashedFolders.has(op.parentId)) { refuse(n, 'The target folder goes to Trash in this set.'); break; }
                if (target === op.id || ancestors(target!).includes(op.id)) { refuse(n, "A folder can't go inside itself."); break; }
                const old = w.get(node.parentId!)!;
                v.baseline = { parentId: node.parentId, index: originalIndex.get(op.id) ?? old.children.indexOf(op.id) };
                old.children = old.children.filter(c => c !== op.id);
                const at = op.index === undefined ? tn.children.length : Math.min(op.index, tn.children.length);
                tn.children.splice(at, 0, op.id);
                node.parentId = tn.id;
                break;
            }
            case 'rename': {
                if (!reachable(op.id)) { refuse(n, UNKNOWN); break; }
                const node = w.get(op.id)!;
                if (node.permanent) { refuse(n, "Chrome's own folders can't be renamed."); break; }
                if (node.managed) { refuse(n, 'Managed by your organisation.'); break; }
                if (!op.title) { refuse(n, 'A title cannot be empty.'); break; }
                if (op.title.length > MAX_TITLE) { refuse(n, `Titles can be at most ${MAX_TITLE} characters.`); break; }
                if (op.title === node.title) { refuse(n, 'It already has that title.'); break; }
                v.baseline = { title: node.title };
                node.title = op.title;
                break;
            }
            case 'set_tags': {
                if (!reachable(op.id)) { refuse(n, UNKNOWN); break; }
                const node = w.get(op.id)!;
                if (!node.url) { refuse(n, 'Only bookmarks have tags, not folders.'); break; }
                if (op.tags.length > MAX_TAGS) { refuse(n, `At most ${MAX_TAGS} tags.`); break; }
                if (op.tags.some(t => !t || t.length > MAX_TAG_LENGTH)) { refuse(n, `Each tag needs 1 to ${MAX_TAG_LENGTH} characters.`); break; }
                v.baseline = { url: node.url };
                break;
            }
            case 'set_rating': {
                if (!reachable(op.id)) { refuse(n, UNKNOWN); break; }
                const node = w.get(op.id)!;
                if (!node.url) { refuse(n, 'Only bookmarks have ratings, not folders.'); break; }
                if (op.rating !== null && (op.rating < 1 || op.rating > 5)) { refuse(n, 'A rating is 1 to 5, or null to clear it.'); break; }
                v.baseline = { url: node.url };
                break;
            }
            case 'trash': {
                if (!reachable(op.id)) { refuse(n, UNKNOWN); break; }
                const node = w.get(op.id)!;
                if (node.permanent) { refuse(n, "Chrome's own folders can't be deleted."); break; }
                if (anyManaged(op.id)) { refuse(n, 'Managed by your organisation.'); break; }
                if (ancestors(op.id).some(a => trashedFolders.has(a))) { refuse(n, 'It is inside a folder that already goes to Trash in this set.'); break; }
                const ids = subtreeIds(op.id);
                if (ids.some(id => createdBy.has(id))) { refuse(n, 'A folder created in this set cannot also go to Trash.'); break; }
                const parent = w.get(node.parentId!)!;
                v.baseline = { parentId: node.parentId, index: originalIndex.get(op.id) ?? parent.children.indexOf(op.id), url: node.url, descendantIds: ids };
                impact += ids.length;
                break;
            }
        }
    }

    // Tags and ratings live per URL: two bookmarks with one URL share them.
    const perUrl = new Map<string, { tags?: string; rating?: string }>();
    for (const n of order) {
        const op = set.ops[n];
        const v = verdicts[n];
        if (!v.ok || (op.op !== 'set_tags' && op.op !== 'set_rating')) continue;
        const url = v.baseline!.url!;
        const entry = perUrl.get(url) ?? {};
        const value = op.op === 'set_tags' ? JSON.stringify([...op.tags].sort()) : JSON.stringify(op.rating);
        const field = op.op === 'set_tags' ? 'tags' : 'rating';
        if (entry[field] !== undefined && entry[field] !== value) refuse(n, 'Another bookmark with the same link gets a different value; links share tags and ratings.');
        entry[field] = value;
        perUrl.set(url, entry);
    }

    if (impact > MAX_IMPACT_NODES) {
        set.ops.forEach((op, n) => { if (op.op === 'trash' && verdicts[n].ok) refuse(n, `This set would remove more than ${MAX_IMPACT_NODES} items. Ask for a smaller set.`); });
    }

    return { ok: verdicts.every(v => v.ok), verdicts, order, impact };
}
