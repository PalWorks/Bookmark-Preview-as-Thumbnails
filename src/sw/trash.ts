// SPDX-License-Identifier: AGPL-3.0-only
//
// Trash coordinator. Runs only in the regular-profile service worker; it is the
// single writer of every trash_* key. No import side effects: sw.ts creates the
// service and wires listeners.
//
// State machine of one entry (progress record trash_prog_<entryId>):
//
//            delete: snapshot written           bookmark removed
//   (none) ───────────────────────▶ prepared ───────────────────▶ deleted ◀──────┐
//                                     │ removal failed: entry dropped  │ restore    │
//                                     ▼                                ▼            │
//                               (nothing kept)                    restoring        │
//                                                                  │      │         │
//                                                            done  │      │ error   │
//                                                                  ▼      ▼         │
//                                                           restored    failed ─────┘
//                                                          (10 minutes)   (Retry resumes)
//
// Crash recovery (reconcile, before every mutation): a 'prepared' entry whose root
// still exists is dropped (the delete never happened), otherwise promoted to
// 'deleted'; a 'restoring' entry is always stale inside the queue and becomes
// 'failed'. A retried restore reuses nodes it already created (same parent, same
// title and URL, created after the first attempt began) instead of duplicating.
//
// Every mutation runs through one promise queue, so two extension tabs pressing
// Undo on the same operation produce one copy.
//
// Deletes made outside this extension (Chrome's bookmark manager, sync, another
// device) reach noteRemoved() from the worker's onRemoved listener. Events are
// buffered and written as one 'external' operation 3 seconds after the last one
// (or at 5,000 roots, or 60 seconds after the first). The parent's location is
// looked up the moment the event arrives, because a later event may remove the
// parent too. The extension's own deletes are recognised by the ids deleteNow is
// removing (memory) and by the root ids of saved entries (storage, survives a
// worker restart).

import {
    TRASH_ENTRY_PREFIX, TRASH_PROGRESS_PREFIX, TRASH_REQUEST_PREFIX, TRASH_REV_KEY, TRASH_PURGE_KEY,
    TRASH_RESTORING_KEY, TRASH_RECREATED_KEY, TRASH_RETENTION_MS, RESTORED_KEEP_MS, REQUEST_KEEP_MS,
    TRASH_EXTERNAL_SETTING,
    entryKey, progressKey, requestKey, listLocalKeys, readTrash, collectUrls, countSaved, folderIds,
    type TrashEntry, type SavedFolderPref, type SavedNode, type TrashProgress, type TrashItem, type TrashOrigin, type TrashDeleteResult,
    type TrashRestoreResult, type TrashRestoreItemResult, type TrashEmptyResult, type TrashRejectReason,
} from '../lib/trash_store';
import {
    ROOT_ID, toSavedNode, getNode, getAncestors, getPermanentRoot, isPermanent, isManaged, createSubtree,
    type BookmarkNode,
} from '../lib/bookmark_tree';
import { db } from '../lib/indexeddb';
import { readFolderPrefsFor } from '../lib/folder_prefs';

const RESTORE_GUARD_MS = 60 * 1000;
const CHECKPOINT_EVERY = 25;
/** Upper bound for one delete request; Duplicate Finder sends at most a few thousand ids. */
const MAX_DELETE_IDS = 10000;
/** External deletes: quiet time before a burst is written, and when a burst is cut. */
const EXTERNAL_QUIET_MS = 3000;
const EXTERNAL_MAX_MS = 60 * 1000;
const EXTERNAL_MAX_ROOTS = 5000;
/** How long ids removed by deleteNow are remembered, so their events are not "external". */
const SELF_REMOVED_KEEP_MS = 60 * 1000;

export interface TrashServiceDeps {
    now?: () => number;
    uuid?: () => string;
    broadcast?: (message: { type: 'TRASH_CHANGED'; rev: number }) => void;
    /** Write folder prefs onto restored folders (the folder prefs service owns those keys). */
    applyFolderPrefs?: (map: Array<{ newId: string; pref: SavedFolderPref }>) => Promise<void>;
    /** Whether deletes made outside the extension are recorded (sync setting, default on). */
    externalEnabled?: () => Promise<boolean>;
}

interface ExternalContext {
    /** Root first, ending with the removed node's parent. */
    chain: BookmarkNode[];
}

interface ExternalEvent {
    seq: number;
    at: number;
    id: string;
    info: { parentId: string; index: number; node?: BookmarkNode };
    ctx: Promise<ExternalContext | undefined>;
}

export interface DeleteRequest {
    ids: string[];
    requestId?: string;
    origin?: TrashOrigin;
}

export interface RestoreRequest {
    operationId?: string;
    entryId?: string;
    /** Restore here instead of the original location (the "Restore to..." picker). */
    targetParentId?: string;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) return String((err as { message: unknown }).message);
    return String(err);
}

export function createTrashService(deps: TrashServiceDeps = {}) {
    const now = deps.now ?? (() => Date.now());
    const uuid = deps.uuid ?? (() => crypto.randomUUID());
    const broadcast = deps.broadcast ?? ((message) => {
        chrome.runtime.sendMessage(message).catch(() => { /* no extension page open */ });
    });

    let queue: Promise<unknown> = Promise.resolve();
    let restoringUntil = 0;
    let restoringWrittenUntil = 0;
    const applyFolderPrefs = deps.applyFolderPrefs ?? (async () => undefined);
    const externalEnabled = deps.externalEnabled ?? (async () => {
        const r = await chrome.storage.sync.get(TRASH_EXTERNAL_SETTING).catch(() => ({} as Record<string, unknown>));
        return r[TRASH_EXTERNAL_SETTING] !== false;
    });
    /** Ids deleteNow is removing or just removed (id -> forget after). */
    const selfRemoved = new Map<string, number>();
    let externalBuffer: ExternalEvent[] = [];
    let externalSeq = 0;
    let externalTimer: ReturnType<typeof setTimeout> | null = null;
    let externalFlushing: Promise<unknown> = Promise.resolve();

    /** Run `fn` after every earlier mutation, with crash recovery first. */
    function enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = queue.catch(() => undefined).then(async () => {
            await reconcileNow().catch(err => console.error('[Trash] reconcile failed', err));
            return fn();
        });
        queue = run.catch(() => undefined);
        return run;
    }

    async function bumpRev(): Promise<void> {
        const rev = now();
        await chrome.storage.local.set({ [TRASH_REV_KEY]: rev });
        broadcast({ type: 'TRASH_CHANGED', rev });
    }

    async function setProgress(progress: TrashProgress): Promise<void> {
        await chrome.storage.local.set({ [progressKey(progress.entryId)]: { ...progress, updatedAt: now() } });
    }

    async function removeItems(entryIds: string[]): Promise<void> {
        if (entryIds.length === 0) return;
        await chrome.storage.local.remove(entryIds.flatMap(id => [entryKey(id), progressKey(id)]));
    }

    // ── Restore guard (auto-capture must not run for restored bookmarks) ─────

    function markRestoring(): void {
        restoringUntil = now() + RESTORE_GUARD_MS;
        // The incognito worker cannot see this module's memory; it reads a
        // timestamp from storage. Written at most every 10 seconds.
        if (restoringUntil - restoringWrittenUntil > 10_000) {
            restoringWrittenUntil = restoringUntil;
            chrome.storage.local.set({ [TRASH_RESTORING_KEY]: restoringUntil }).catch(() => undefined);
        }
    }

    /**
     * Write the final guard time for the incognito worker. The guard is never
     * cleared early: Chrome delivers onCreated events after create() resolves,
     * so it must outlive the last create by a margin.
     */
    async function flushRestoring(): Promise<void> {
        if (restoringUntil <= restoringWrittenUntil) return;
        restoringWrittenUntil = restoringUntil;
        await chrome.storage.local.set({ [TRASH_RESTORING_KEY]: restoringUntil }).catch(() => undefined);
    }

    // ── Reconcile ────────────────────────────────────────────────────────────

    async function reconcileNow(): Promise<boolean> {
        const keys = await listLocalKeys();
        const progKeys = keys.filter(k => k.startsWith(TRASH_PROGRESS_PREFIX));
        const entryIds = new Set(keys.filter(k => k.startsWith(TRASH_ENTRY_PREFIX)).map(k => k.slice(TRASH_ENTRY_PREFIX.length)));
        const progIds = new Set(progKeys.map(k => k.slice(TRASH_PROGRESS_PREFIX.length)));
        let changed = false;

        // A progress record without its snapshot is useless; an entry without
        // progress (interrupted multi-key write) is kept as deleted.
        const orphanProgress = [...progIds].filter(id => !entryIds.has(id));
        if (orphanProgress.length) {
            await chrome.storage.local.remove(orphanProgress.map(progressKey));
            changed = true;
        }
        for (const id of entryIds) {
            if (progIds.has(id)) continue;
            await setProgress({ entryId: id, state: 'deleted', updatedAt: now() });
            changed = true;
        }

        const live = [...progIds].filter(id => entryIds.has(id));
        if (live.length === 0) return changed;
        const progs = await chrome.storage.local.get(live.map(progressKey));
        for (const id of live) {
            const p = progs[progressKey(id)] as TrashProgress | undefined;
            if (!p) continue;
            if (p.state === 'prepared') {
                const data = await chrome.storage.local.get(entryKey(id));
                const entry = data[entryKey(id)] as TrashEntry | undefined;
                const stillThere = entry ? await getNode(entry.tree.oldId) : undefined;
                if (stillThere) {
                    await removeItems([id]);
                    console.warn('[Trash] dropped a delete that never happened', id);
                } else {
                    await setProgress({ ...p, state: 'deleted' });
                }
                changed = true;
            } else if (p.state === 'restoring') {
                await setProgress({
                    ...p, state: 'failed',
                    error: 'Restore was interrupted. Select Retry to finish it.',
                });
                changed = true;
            }
        }
        if (changed) await bumpRev();
        return changed;
    }

    // ── Helpers shared by both kinds of delete ───────────────────────────────

    async function savedPrefsFor(tree: SavedNode): Promise<Record<string, SavedFolderPref> | undefined> {
        const ids = folderIds(tree);
        if (ids.length === 0) return undefined;
        const prefs = await readFolderPrefsFor(ids).catch(() => ({}));
        return Object.keys(prefs).length ? prefs : undefined;
    }

    function markSelfRemoved(tree: SavedNode): void {
        const until = now() + SELF_REMOVED_KEEP_MS;
        const walk = (n: SavedNode) => { selfRemoved.set(n.oldId, until); (n.children ?? []).forEach(walk); };
        walk(tree);
    }

    function unmarkSelfRemoved(tree: SavedNode): void {
        const walk = (n: SavedNode) => { selfRemoved.delete(n.oldId); (n.children ?? []).forEach(walk); };
        walk(tree);
    }

    function forgetExpiredSelfRemoved(): void {
        const t = now();
        for (const [id, until] of selfRemoved) if (until <= t) selfRemoved.delete(id);
    }

    // ── Delete ───────────────────────────────────────────────────────────────

    async function deleteNow(req: DeleteRequest): Promise<TrashDeleteResult> {
        // A retried message is a no-op; if the first attempt died part-way, the
        // retry continues the same operation so one Undo still covers it all.
        let resumedOperationId: string | undefined;
        if (req.requestId) {
            const cached = await chrome.storage.local.get(requestKey(req.requestId));
            const hit = cached[requestKey(req.requestId)] as { at: number; result?: TrashDeleteResult; operationId?: string } | undefined;
            if (hit?.result) return hit.result;
            resumedOperationId = hit?.operationId;
        }

        const ids = [...new Set(req.ids)];
        const skipped: string[] = [];
        const found: BookmarkNode[] = [];
        for (const id of ids) {
            const node = await getNode(id);
            if (node) found.push(node); else skipped.push(id);
        }

        // Protected nodes reject the whole request, so one operation is always one Undo.
        const rejected: Array<{ id: string; title: string; reason: TrashRejectReason }> = [];
        const subtrees = new Map<string, BookmarkNode>();
        for (const node of found) {
            if (isPermanent(node)) { rejected.push({ id: node.id, title: node.title, reason: 'permanent' }); continue; }
            if (isManaged(node)) { rejected.push({ id: node.id, title: node.title, reason: 'managed' }); continue; }
            const sub = node.url ? node : (await chrome.bookmarks.getSubTree(node.id))[0];
            const anyManaged = (n: BookmarkNode): boolean => isManaged(n) || (n.children ?? []).some(anyManaged);
            if (anyManaged(sub)) { rejected.push({ id: node.id, title: node.title, reason: 'managed' }); continue; }
            subtrees.set(node.id, sub);
        }
        if (rejected.length) return { ok: false, rejected, skipped };

        // Drop ids nested inside another selected folder: the folder covers them.
        const selected = new Set(found.map(n => n.id));
        const chains = new Map<string, BookmarkNode[]>();
        const parentCache = new Map<string, BookmarkNode | undefined>();
        for (const node of found) chains.set(node.id, await getAncestors(node, parentCache));
        const roots = found.filter(n => !(chains.get(n.id) ?? []).some(a => selected.has(a.id)));
        if (roots.length === 0) return { ok: true, removedCount: 0, removedRoots: 0, skipped };

        const operationId = resumedOperationId ?? uuid();
        const deletedAt = now();
        const origin: TrashOrigin = req.origin === 'duplicate-finder' ? 'duplicate-finder' : 'manual';
        const entries: TrashEntry[] = roots.map(node => {
            const chain = chains.get(node.id) ?? [];
            const top = chain[0];
            const tree = toSavedNode(subtrees.get(node.id) ?? node);
            const counts = countSaved(tree);
            return {
                version: 1,
                entryId: uuid(),
                operationId,
                origin,
                title: node.title ?? '',
                isFolder: !node.url,
                bookmarkCount: counts.bookmarks,
                nodeCount: counts.nodes,
                deletedAt,
                expiresAt: deletedAt + TRASH_RETENTION_MS,
                parentId: node.parentId ?? '',
                index: node.index ?? 0,
                ancestors: chain.map(a => ({ oldId: a.id, title: a.title ?? '' })),
                scope: {
                    rootId: top?.id ?? node.parentId ?? '',
                    rootTitle: top?.title ?? '',
                    ...(top?.folderType !== undefined ? { folderType: top.folderType } : {}),
                    ...(top && typeof top.syncing === 'boolean' ? { syncing: top.syncing } : {}),
                },
                tree,
            };
        });

        // Folder colours and search visibility travel with the entry, so Undo brings them back.
        for (const e of entries) {
            const prefs = await savedPrefsFor(e.tree);
            if (prefs) e.folderPrefs = prefs;
        }

        // Persist every snapshot before the first removal. If this fails, nothing is removed.
        const prepared: Record<string, unknown> = {};
        for (const e of entries) {
            prepared[entryKey(e.entryId)] = e;
            prepared[progressKey(e.entryId)] = { entryId: e.entryId, state: 'prepared', updatedAt: deletedAt } satisfies TrashProgress;
        }
        if (req.requestId) prepared[requestKey(req.requestId)] = { at: deletedAt, operationId };
        try {
            await chrome.storage.local.set(prepared);
        } catch (err) {
            console.error('[Trash] could not save snapshot', operationId, err);
            return { ok: false, error: "Couldn't save to Trash, so nothing was deleted.", skipped };
        }

        const failed: Array<{ id: string; error: string }> = [];
        const done: TrashEntry[] = [];
        const settled: Record<string, unknown> = {};
        for (const e of entries) {
            markSelfRemoved(e.tree);
            try {
                if (e.isFolder) {
                    // Something may have been moved into the folder while the snapshot was
                    // being written (another tab, Chrome's manager, sync). Re-check right
                    // before removing, so nothing is removed that Undo could not restore.
                    const fresh = (await chrome.bookmarks.getSubTree(e.tree.oldId))[0];
                    const freshTree = toSavedNode(fresh);
                    if (JSON.stringify(freshTree) !== JSON.stringify(e.tree)) {
                        const counts = countSaved(freshTree);
                        e.tree = freshTree;
                        markSelfRemoved(freshTree);
                        e.bookmarkCount = counts.bookmarks;
                        e.nodeCount = counts.nodes;
                        await chrome.storage.local.set({ [entryKey(e.entryId)]: e });
                    }
                    await chrome.bookmarks.removeTree(e.tree.oldId);
                }
                else await chrome.bookmarks.remove(e.tree.oldId);
                settled[progressKey(e.entryId)] = { entryId: e.entryId, state: 'deleted', updatedAt: now() } satisfies TrashProgress;
                done.push(e);
            } catch (err) {
                failed.push({ id: e.tree.oldId, error: errorMessage(err) });
                // Still there: a later delete of it in Chrome must reach Trash.
                unmarkSelfRemoved(e.tree);
                console.error('[Trash] remove failed', operationId, e.tree.oldId, err);
            }
        }
        // The bookmarks are already removed. If recording that fails, reconcile
        // promotes the prepared entries later; the answer must still say "deleted".
        try {
            if (Object.keys(settled).length) await chrome.storage.local.set(settled);
            await removeItems(entries.filter(e => !done.includes(e)).map(e => e.entryId));
        } catch (err) {
            console.error('[Trash] could not record delete outcome; reconcile will finish it', operationId, err);
        }

        const result: TrashDeleteResult = {
            ok: done.length > 0,
            operationId: done.length ? operationId : undefined,
            entryIds: done.map(e => e.entryId),
            removedCount: done.reduce((n, e) => n + e.bookmarkCount, 0),
            removedRoots: done.length,
            firstTitle: done[0]?.title,
            skipped,
            failed,
            ...(done.length === 0 ? { error: failed[0]?.error ?? 'Nothing was deleted.' } : {}),
        };
        if (req.requestId) {
            await chrome.storage.local.set({ [requestKey(req.requestId)]: { at: now(), operationId, result } }).catch(() => undefined);
        }
        if (done.length) await bumpRev().catch(() => undefined);
        console.log('[Trash] deleted', { operationId, roots: done.length, failed: failed.length, skipped: skipped.length });
        return result;
    }

    // ── Restore ──────────────────────────────────────────────────────────────

    async function inScope(node: BookmarkNode, scope: TrashEntry['scope']): Promise<boolean> {
        if (isManaged(node)) return false;
        const root = await getPermanentRoot(node);
        if (scope.folderType !== undefined && root.folderType !== undefined) {
            return root.folderType === scope.folderType && !!root.syncing === !!scope.syncing;
        }
        return root.id === scope.rootId;
    }

    async function recreatedFolderIds(): Promise<Set<string>> {
        const data = await chrome.storage.local.get(TRASH_RECREATED_KEY);
        return new Set(Object.keys((data[TRASH_RECREATED_KEY] as Record<string, number> | undefined) ?? {}));
    }

    async function findOrCreateFolder(parentId: string, title: string): Promise<BookmarkNode> {
        const children = await chrome.bookmarks.getChildren(parentId);
        const existing = children.find(c => !c.url && c.title === title && !isManaged(c));
        if (existing) return existing;
        markRestoring();
        const folder = await chrome.bookmarks.create({ parentId, title });
        // Remember it, so a later restore of the original folder merges into it.
        const data = await chrome.storage.local.get(TRASH_RECREATED_KEY);
        const map = { ...((data[TRASH_RECREATED_KEY] as Record<string, number> | undefined) ?? {}), [folder.id]: now() };
        await chrome.storage.local.set({ [TRASH_RECREATED_KEY]: map });
        return folder;
    }

    /**
     * Where to put an entry back: the deepest surviving ancestor in the same
     * storage scope, recreating missing folders below it by title; else a
     * permanent folder of the same type and sync state. Undefined: ask the user.
     * A title match never chooses a scope, so a local bookmark is never moved
     * into a synced account folder automatically.
     */
    async function resolveParent(entry: TrashEntry): Promise<{ id: string; original: boolean } | undefined> {
        const anc = entry.ancestors;
        for (let i = anc.length - 1; i >= 0; i--) {
            const node = await getNode(anc[i].oldId);
            if (!node || node.url) continue;
            if (!(await inScope(node, entry.scope))) return undefined;
            let pid = node.id;
            for (const missing of anc.slice(i + 1)) pid = (await findOrCreateFolder(pid, missing.title)).id;
            return { id: pid, original: i === anc.length - 1 };
        }
        if (entry.scope.folderType !== undefined) {
            const permanent = await chrome.bookmarks.getChildren(ROOT_ID);
            const match = permanent.find(r => r.folderType === entry.scope.folderType
                && !!r.syncing === !!entry.scope.syncing && !isManaged(r));
            if (match) {
                let pid = match.id;
                for (const missing of anc.slice(1)) pid = (await findOrCreateFolder(pid, missing.title)).id;
                return { id: pid, original: false };
            }
        }
        return undefined;
    }

    async function pathOf(folderId: string): Promise<string[]> {
        const node = await getNode(folderId);
        if (!node) return [];
        const chain = await getAncestors(node);
        return [...chain, node].map(n => n.title || 'Untitled folder');
    }

    async function restoreOne(item: TrashItem, targetParentId?: string): Promise<TrashRestoreItemResult> {
        const { entry } = item;
        const prior = item.progress;
        // Resume only when an earlier attempt actually created something. Reuse is
        // limited to nodes created between that attempt's start and its failure
        // record, so a bookmark the user added later is never taken over.
        // Any earlier attempt counts: the worker can die after a create() but before
        // its checkpoint, so "nothing recorded" does not mean "nothing created".
        const resume = prior.restoreStartedAt !== undefined;
        const startedAt = resume ? prior.restoreStartedAt! : now();
        const resumeUntil = prior.updatedAt + 2000;
        let created = resume ? (prior.created ?? 0) : 0;
        let partialRootId = resume ? prior.partialRootId : undefined;
        const base: TrashProgress = { entryId: entry.entryId, state: 'restoring', updatedAt: now(), restoreStartedAt: startedAt, created, partialRootId };
        await setProgress(base);
        markRestoring();

        let target: { id: string; original: boolean } | undefined;
        if (targetParentId) {
            const node = await getNode(targetParentId);
            if (!node || node.url || node.id === ROOT_ID || isManaged(node)) {
                const error = 'That folder is no longer available. Choose another one.';
                await setProgress({ ...base, state: 'failed', error, needsDestination: true });
                return { entryId: entry.entryId, state: 'failed', error, needsDestination: true };
            }
            target = { id: node.id, original: node.id === entry.parentId };
        } else {
            target = await resolveParent(entry);
        }
        if (!target) {
            const error = 'The original folder no longer exists here. Choose where to restore it.';
            await setProgress({ ...base, state: 'failed', error, needsDestination: true });
            return { entryId: entry.entryId, state: 'failed', error, needsDestination: true };
        }
        const targetId = target.id;

        // A half-restored copy from an earlier attempt moves to the new destination,
        // so the retry finishes it there instead of leaving a partial copy behind.
        if (resume && partialRootId) {
            const partial = await getNode(partialRootId);
            if (partial && partial.parentId !== targetId) {
                try {
                    await chrome.bookmarks.move(partialRootId, { parentId: targetId });
                } catch (err) {
                    console.warn('[Trash] could not move the partial copy', partialRootId, err);
                }
            }
        }

        const claimed = new Map<string, BookmarkNode[]>();
        const fromInterruptedAttempt = async (pid: string, saved: TrashEntry['tree']) => {
            let list = claimed.get(pid);
            if (!list) {
                const children = await chrome.bookmarks.getChildren(pid).catch(() => [] as BookmarkNode[]);
                list = children.filter(c => (c.dateAdded ?? 0) >= startedAt - 2000 && (c.dateAdded ?? 0) <= resumeUntil);
                claimed.set(pid, list);
            }
            const i = list.findIndex(c => c.title === saved.title && (c.url ?? '') === (saved.url ?? ''));
            return i < 0 ? undefined : list.splice(i, 1)[0];
        };
        // A folder whose child was restored earlier (delete "Soup", then delete
        // "Recipes", then Undo both) already has a copy recreated by that restore:
        // merge into it. A folder the user made themselves is never merged into.
        const recreatedFolder = async (pid: string) => {
            const recreated = await recreatedFolderIds();
            const children = await chrome.bookmarks.getChildren(pid).catch(() => [] as BookmarkNode[]);
            return children.find(c => !c.url && c.title === entry.title && !isManaged(c) && recreated.has(c.id));
        };

        // Something deleted on another device may already be back (restored there and
        // synced here). External entries reuse an identical bookmark, or a folder with
        // the same title and the same links, instead of making a duplicate; inside a
        // reused folder, identical children are reused too.
        const reusedFolders = new Set<string>();
        const linksOf = (n: { url?: string; title?: string; children?: Array<{ url?: string; title?: string; children?: unknown[] }> }, out: string[] = []): string[] => {
            if (n.url) out.push(`${n.title}\n${n.url}`);
            for (const c of n.children ?? []) linksOf(c as never, out);
            return out;
        };
        const sameLinks = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0');
        const alreadyPresent = async (pid: string, saved: SavedNode): Promise<BookmarkNode | undefined> => {
            const children = await chrome.bookmarks.getChildren(pid).catch(() => [] as BookmarkNode[]);
            if (saved.url) return children.find(c => c.url === saved.url && c.title === saved.title);
            const candidates = children.filter(c => !c.url && c.title === saved.title && !isManaged(c));
            if (reusedFolders.has(pid)) return candidates[0];
            const want = linksOf(saved);
            for (const c of candidates) {
                const sub = (await chrome.bookmarks.getSubTree(c.id).catch(() => []))[0];
                if (sub && sameLinks(linksOf(sub), want)) return c;
            }
            return undefined;
        };
        const prefsToApply: Array<{ newId: string; pref: SavedFolderPref }> = [];

        try {
            const root = await createSubtree(entry.tree, targetId, {
                index: target.original ? entry.index : undefined,
                findExisting: async (pid, saved) => {
                    const reused = resume ? await fromInterruptedAttempt(pid, saved) : undefined;
                    if (reused) return reused;
                    if (saved === entry.tree && entry.isFolder && pid === targetId) {
                        const merged = await recreatedFolder(pid);
                        if (merged) return merged;
                    }
                    if (entry.origin === 'external' && (saved === entry.tree || reusedFolders.has(pid))) {
                        const present = await alreadyPresent(pid, saved);
                        if (present && !present.url) reusedFolders.add(present.id);
                        if (present) return present;
                    }
                    return undefined;
                },
                onNode: async (saved, node, wasCreated) => {
                    const pref = entry.folderPrefs?.[saved.oldId];
                    if (pref && !saved.url) prefsToApply.push({ newId: node.id, pref });
                    if (saved === entry.tree) {
                        partialRootId = node.id;
                        await setProgress({ ...base, created, partialRootId });
                    }
                    if (!wasCreated) return;
                    created++;
                    markRestoring();
                    if (created % CHECKPOINT_EVERY === 0) await setProgress({ ...base, created, partialRootId });
                },
            });
            await applyFolderPrefs(prefsToApply).catch(err => console.warn('[Trash] could not restore folder colours', entry.entryId, err));
            const restoredTo = { parentId: targetId, rootId: root.id, path: await pathOf(targetId) };
            await setProgress({ ...base, state: 'restored', created, partialRootId, restoredTo, keepUntil: now() + RESTORED_KEEP_MS });
            return { entryId: entry.entryId, state: 'restored', restoredTo };
        } catch (err) {
            const error = `Restore stopped: ${errorMessage(err)}`;
            console.error('[Trash] restore failed', entry.entryId, err);
            await setProgress({ ...base, state: 'failed', created, partialRootId, error });
            return { entryId: entry.entryId, state: 'failed', error };
        }
    }

    async function restoreNow(req: RestoreRequest): Promise<TrashRestoreResult> {
        const all = await readTrash();
        const items = all.filter(i => (req.entryId ? i.entry.entryId === req.entryId : i.entry.operationId === req.operationId));
        if (items.length === 0) return { ok: false, error: 'Nothing to restore. It may have been emptied from Trash.' };

        // Original order: a parent's roots in ascending original index, so positions
        // line up (external entries store original positions too, see recordExternalNow).
        items.sort((a, b) => a.entry.parentId.localeCompare(b.entry.parentId) || a.entry.index - b.entry.index);
        const results: TrashRestoreItemResult[] = [];
        let changed = false;
        try {
            for (const item of items) {
                const state = item.progress.state;
                if (state === 'restored') {
                    results.push({ entryId: item.entry.entryId, state, restoredTo: item.progress.restoredTo });
                    continue;
                }
                if (state !== 'deleted' && state !== 'failed') {
                    results.push({ entryId: item.entry.entryId, state });
                    continue;
                }
                changed = true;
                results.push(await restoreOne(item, req.targetParentId));
            }
        } finally {
            await flushRestoring();
            if (changed) await bumpRev();
        }
        const restoredCount = results.filter(r => r.state === 'restored').length;
        const failedCount = results.filter(r => r.state === 'failed').length;
        console.log('[Trash] restore', { operationId: req.operationId, entryId: req.entryId, restoredCount, failedCount });
        return { ok: failedCount === 0, results, restoredCount, failedCount };
    }

    // ── Empty, expiry and the asset sweep ────────────────────────────────────

    async function addPurgePending(urls: Iterable<string>): Promise<void> {
        const cur = await chrome.storage.local.get(TRASH_PURGE_KEY);
        const set = new Set<string>(((cur[TRASH_PURGE_KEY] as { urls?: string[] } | undefined)?.urls) ?? []);
        for (const u of urls) set.add(u);
        if (set.size) await chrome.storage.local.set({ [TRASH_PURGE_KEY]: { urls: [...set], at: now() } });
    }

    /**
     * Remove cached previews and metadata for URLs that no live bookmark and no
     * remaining Trash entry uses. The inventory is journaled in trash_purge_pending
     * first and cleared last, so a crash resumes the sweep. Failures stay queued.
     */
    async function sweepAssets(): Promise<number> {
        const cur = await chrome.storage.local.get(TRASH_PURGE_KEY);
        const pending = ((cur[TRASH_PURGE_KEY] as { urls?: string[] } | undefined)?.urls) ?? [];
        if (pending.length === 0) return 0;
        const referenced = new Set<string>();
        for (const item of await readTrash()) collectUrls(item.entry.tree, referenced);

        const retry: string[] = [];
        let purged = 0;
        for (const url of pending) {
            if (referenced.has(url)) continue;
            let live = true;
            try {
                live = (await chrome.bookmarks.search({ url })).length > 0;
            } catch {
                live = true; // unsearchable URL (for example a bookmarklet): keep its assets
            }
            if (live) continue;
            try {
                await chrome.storage.local.remove([`thumb_${url}`, `meta_${url}`]);
                await db.deleteThumbnail(url);
                purged++;
            } catch (err) {
                console.warn('[Trash] asset purge failed, will retry', url, err);
                retry.push(url);
            }
        }
        if (retry.length) await chrome.storage.local.set({ [TRASH_PURGE_KEY]: { urls: retry, at: now() } });
        else await chrome.storage.local.remove(TRASH_PURGE_KEY);
        return purged;
    }

    async function emptyNow(): Promise<TrashEmptyResult> {
        const items = await readTrash();
        const removable = items.filter(i => i.progress.state !== 'prepared' && i.progress.state !== 'restoring');
        const urls = new Set<string>();
        let removedBookmarks = 0;
        for (const i of removable) {
            // Restored URLs too: the sweep keeps every URL a live bookmark still uses.
            collectUrls(i.entry.tree, urls);
            if (i.progress.state !== 'restored') removedBookmarks += Math.max(1, i.entry.bookmarkCount);
        }
        try {
            await addPurgePending(urls);
            await removeItems(removable.map(i => i.entry.entryId));
        } catch (err) {
            console.error('[Trash] empty failed', err);
            return { ok: false, error: "Couldn't empty Trash. Try again." };
        }
        await sweepAssets().catch(err => console.error('[Trash] sweep failed', err));
        if (removable.length) await bumpRev();
        return {
            ok: true,
            removedEntries: removable.filter(i => i.progress.state !== 'restored').length,
            removedBookmarks,
            keptEntries: items.length - removable.length,
        };
    }

    async function purgeExpiredNow(): Promise<number> {
        const t = now();
        const items = await readTrash();
        const expired = items.filter(i => {
            const s = i.progress.state;
            if (s === 'deleted' || s === 'failed') return i.entry.expiresAt <= t;
            if (s === 'restored') return (i.progress.keepUntil ?? 0) <= t;
            return false;
        });
        const urls = new Set<string>();
        for (const i of expired) collectUrls(i.entry.tree, urls);
        if (expired.length) {
            await addPurgePending(urls);
            await removeItems(expired.map(i => i.entry.entryId));
        }

        // Recreated-folder ids only matter while their Trash entries can still be restored.
        const rec = await chrome.storage.local.get(TRASH_RECREATED_KEY);
        const recMap = (rec[TRASH_RECREATED_KEY] as Record<string, number> | undefined) ?? {};
        const keep = Object.fromEntries(Object.entries(recMap).filter(([, at]) => at + TRASH_RETENTION_MS > t));
        if (Object.keys(keep).length !== Object.keys(recMap).length) {
            if (Object.keys(keep).length) await chrome.storage.local.set({ [TRASH_RECREATED_KEY]: keep });
            else await chrome.storage.local.remove(TRASH_RECREATED_KEY);
        }

        // Cached delete responses only matter for a few minutes.
        const reqKeys = (await listLocalKeys()).filter(k => k.startsWith(TRASH_REQUEST_PREFIX));
        if (reqKeys.length) {
            const reqs = await chrome.storage.local.get(reqKeys);
            const old = reqKeys.filter(k => ((reqs[k] as { at?: number } | undefined)?.at ?? 0) + REQUEST_KEEP_MS <= t);
            if (old.length) await chrome.storage.local.remove(old);
        }

        await sweepAssets().catch(err => console.error('[Trash] sweep failed', err));
        if (expired.length) await bumpRev();
        return expired.length;
    }

    // ── Deletes made outside this extension ──────────────────────────────────

    async function resolveContext(parentId: string): Promise<ExternalContext | undefined> {
        const parent = await getNode(parentId);
        if (!parent || parent.url) return undefined;
        const chain = [...await getAncestors(parent), parent];
        return { chain };
    }

    /** Called synchronously from chrome.bookmarks.onRemoved. Never awaits. */
    function noteRemoved(id: string, info: { parentId: string; index: number; node?: BookmarkNode }): void {
        const at = now();
        // Look up the location now: a later event in the same burst may remove the parent.
        const ctx = resolveContext(info.parentId).catch(() => undefined);
        externalBuffer.push({ seq: ++externalSeq, at, id, info, ctx });
        const first = externalBuffer[0].at;
        if (externalTimer) clearTimeout(externalTimer);
        externalTimer = null;
        if (externalBuffer.length >= EXTERNAL_MAX_ROOTS || at - first >= EXTERNAL_MAX_MS) {
            void flushExternal();
        } else {
            externalTimer = setTimeout(() => { externalTimer = null; void flushExternal(); }, EXTERNAL_QUIET_MS);
        }
    }

    /** Ids inside deletes that are buffered but not yet written (their prefs must stay). */
    function pendingRemovedIds(): Set<string> {
        const out = new Set<string>();
        const walk = (n: BookmarkNode) => { out.add(n.id); (n.children ?? []).forEach(walk); };
        for (const e of externalBuffer) if (e.info.node) walk(e.info.node);
        return out;
    }

    /** Write buffered external deletes now (also used by tests). */
    function flushExternal(): Promise<unknown> {
        if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
        const events = externalBuffer;
        externalBuffer = [];
        if (events.length === 0) return externalFlushing;
        externalFlushing = enqueue(() => recordExternalNow(events))
            .catch(err => console.error('[Trash] external: could not record deletes', err));
        return externalFlushing;
    }

    async function recordExternalNow(events: ExternalEvent[]): Promise<number> {
        forgetExpiredSelfRemoved();
        let skippedOwn = 0, skippedPermanent = 0, skippedNoParent = 0, skippedNoNode = 0;
        const candidates = events.filter(e => {
            if (!e.info.node) { skippedNoNode++; return false; }
            if (selfRemoved.has(e.id)) { skippedOwn++; return false; }
            if (!e.info.parentId || e.info.parentId === ROOT_ID) { skippedPermanent++; return false; }
            // Removed by an organisation's policy: not the user's to restore.
            if (isManaged(e.info.node)) { skippedPermanent++; return false; }
            return true;
        });
        if (candidates.length === 0) return 0;
        if (!(await externalEnabled())) {
            console.log('[Trash] external: recording is off; not keeping', candidates.length);
            return 0;
        }
        // The extension's own deletes from before a worker restart.
        const ownRoots = new Set((await readTrash()).map(i => i.entry.tree.oldId));
        const kept = candidates.filter(e => {
            if (ownRoots.has(e.id)) { skippedOwn++; return false; }
            return true;
        });

        // Children removed before their folder (bottom-up sync): put them back inside
        // the folder's saved tree, latest first so their saved positions line up.
        const trees = new Map<number, SavedNode>(kept.map(e => [e.seq, toSavedNode(e.info.node!)]));
        const findIn = (n: SavedNode, oldId: string): SavedNode | undefined => {
            if (n.oldId === oldId) return n;
            for (const c of n.children ?? []) { const f = findIn(c, oldId); if (f) return f; }
            return undefined;
        };
        const nested = new Set<number>();
        for (const e of [...kept].sort((a, b) => b.seq - a.seq)) {
            for (const other of kept) {
                if (other.seq === e.seq || nested.has(other.seq)) continue;
                const host = findIn(trees.get(other.seq)!, e.info.parentId);
                if (host && !host.url) {
                    const kids = host.children ?? (host.children = []);
                    kids.splice(Math.max(0, Math.min(e.info.index, kids.length)), 0, trees.get(e.seq)!);
                    nested.add(e.seq);
                    break;
                }
            }
        }

        // Each index was taken after the earlier removals in this burst. Replay the
        // removals of a folder backwards to get every item's original position, so a
        // restore (to the original folder or elsewhere) keeps the original order.
        const originalIndex = new Map<number, number>();
        const byParent = new Map<string, ExternalEvent[]>();
        for (const e of kept) {
            if (nested.has(e.seq)) continue;
            byParent.set(e.info.parentId, [...(byParent.get(e.info.parentId) ?? []), e]);
        }
        for (const list of byParent.values()) {
            const placed: Array<{ seq: number; pos: number }> = [];
            for (const e of [...list].sort((a, b) => b.seq - a.seq)) {
                for (const p of placed) if (p.pos >= e.info.index) p.pos++;
                placed.push({ seq: e.seq, pos: e.info.index });
            }
            for (const p of placed) originalIndex.set(p.seq, p.pos);
        }

        const operationId = uuid();
        const toSet: Record<string, unknown> = {};
        let roots = 0, nodes = 0;
        for (const e of kept) {
            if (nested.has(e.seq)) continue;
            const ctx = await e.ctx;
            // Parent already gone when the event arrived and not part of this burst:
            // a whole account tree going away (sign-out). Not kept on purpose.
            if (!ctx) { skippedNoParent++; continue; }
            const top = ctx.chain[0];
            const tree = trees.get(e.seq)!;
            const counts = countSaved(tree);
            const entry: TrashEntry = {
                version: 1,
                entryId: uuid(),
                operationId,
                origin: 'external',
                title: tree.title,
                isFolder: !tree.url,
                bookmarkCount: counts.bookmarks,
                nodeCount: counts.nodes,
                deletedAt: e.at,
                expiresAt: e.at + TRASH_RETENTION_MS,
                parentId: e.info.parentId,
                index: originalIndex.get(e.seq) ?? e.info.index,
                ancestors: ctx.chain.map(a => ({ oldId: a.id, title: a.title ?? '' })),
                scope: {
                    rootId: top.id,
                    rootTitle: top.title ?? '',
                    ...(top.folderType !== undefined ? { folderType: top.folderType } : {}),
                    ...(typeof top.syncing === 'boolean' ? { syncing: top.syncing } : {}),
                },
                tree,
                seq: e.seq,
            };
            const prefs = await savedPrefsFor(tree);
            if (prefs) entry.folderPrefs = prefs;
            toSet[entryKey(entry.entryId)] = entry;
            toSet[progressKey(entry.entryId)] = { entryId: entry.entryId, state: 'deleted', updatedAt: now() } satisfies TrashProgress;
            roots++;
            nodes += counts.nodes;
        }
        if (roots) {
            await chrome.storage.local.set(toSet);
            await bumpRev();
        }
        console.log('[Trash] external', { operationId: roots ? operationId : undefined, roots, nodes, nested: nested.size, skippedOwn, skippedPermanent, skippedNoParent, skippedNoNode });
        return roots;
    }

    // ── Public API ───────────────────────────────────────────────────────────

    return {
        deleteItems: (req: DeleteRequest) => enqueue(() => deleteNow(req)),
        restore: (req: RestoreRequest) => enqueue(() => restoreNow(req)),
        empty: () => enqueue(() => emptyNow()),
        purgeExpired: () => enqueue(() => purgeExpiredNow()),
        reconcile: () => enqueue(async () => true),
        noteRemoved,
        flushExternal,
        pendingRemovedIds,
        /** True while a restore is creating bookmarks (auto-capture skips them). */
        isRestoreActive: () => restoringUntil > now(),
    };
}

export type TrashService = ReturnType<typeof createTrashService>;

// ─── Message routing ─────────────────────────────────────────────────────────

export const TRASH_MESSAGE_TYPES = ['TRASH_DELETE', 'TRASH_RESTORE', 'TRASH_EMPTY', 'TRASH_PURGE'] as const;
export type TrashMessageType = typeof TRASH_MESSAGE_TYPES[number];

export function isTrashMessage(message: unknown): message is { type: TrashMessageType } & Record<string, unknown> {
    return typeof message === 'object' && message !== null
        && TRASH_MESSAGE_TYPES.includes((message as { type?: string }).type as TrashMessageType);
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/**
 * Validate and run one TRASH_* message. Only extension pages may call it (content
 * scripts run inside third-party pages), and only the regular-profile worker
 * mutates Trash; the incognito worker answers with a read-only error.
 */
export async function handleTrashMessage(
    service: TrashService,
    message: { type: TrashMessageType } & Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    incognito: boolean,
): Promise<unknown> {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) {
        return { ok: false, error: `${message.type} rejected: not an extension page` };
    }
    if (incognito) {
        return { ok: false, error: 'Trash works in regular windows only.' };
    }
    switch (message.type) {
        case 'TRASH_DELETE': {
            const ids = message.ids;
            if (Array.isArray(ids) && ids.length > MAX_DELETE_IDS) {
                return { ok: false, error: `Too many items for one delete (${MAX_DELETE_IDS.toLocaleString('en')} at most). Delete them in smaller groups.` };
            }
            if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isStr)) {
                return { ok: false, error: 'Invalid TRASH_DELETE message' };
            }
            const requestId = isStr(message.requestId) ? message.requestId : undefined;
            const origin = message.origin === 'duplicate-finder' ? 'duplicate-finder' : 'manual';
            return service.deleteItems({ ids: ids as string[], requestId, origin });
        }
        case 'TRASH_RESTORE': {
            const operationId = isStr(message.operationId) ? message.operationId : undefined;
            const entryId = isStr(message.entryId) ? message.entryId : undefined;
            const targetParentId = isStr(message.targetParentId) ? message.targetParentId : undefined;
            if (!operationId && !entryId) return { ok: false, error: 'Invalid TRASH_RESTORE message' };
            return service.restore({ operationId, entryId, targetParentId });
        }
        case 'TRASH_EMPTY':
            return service.empty();
        case 'TRASH_PURGE':
            return { ok: true, purged: await service.purgeExpired() };
    }
}
