// SPDX-License-Identifier: AGPL-3.0-only
//
// Trash data model, shared by the service worker (sole writer) and the popup
// (reader). DOM-free and React-free so the service worker bundle can import it.
//
// Storage layout in chrome.storage.local:
//   trash_v1_<entryId>     immutable snapshot of one deleted root (TrashEntry)
//   trash_prog_<entryId>   small mutable record: state machine + restore progress
//   trash_req_<requestId>  cached TRASH_DELETE response, so a retried message is a no-op
//   trash_rev              number bumped after every trash mutation (change signal)
//   trash_purge_pending    URLs whose cached previews still need the asset sweep
//   trash_restoring_until  timestamp; auto-capture skips bookmark creations until then
//   trash_recreated_folders  ids of folders a restore recreated (merge target, 30 days)
//
// Deletes made outside this extension (Chrome's manager, sync) are recorded by the
// worker's onRemoved listener as entries with origin 'external'. The sync setting
// `trashExternal` (default true) turns that off.
//
// Entries hold metadata only. Previews come from the existing thumb_<url> records,
// which stay in place while the bookmark sits in Trash.

export const TRASH_ENTRY_PREFIX = 'trash_v1_';
export const TRASH_PROGRESS_PREFIX = 'trash_prog_';
export const TRASH_REQUEST_PREFIX = 'trash_req_';
export const TRASH_REV_KEY = 'trash_rev';
export const TRASH_PURGE_KEY = 'trash_purge_pending';
export const TRASH_RESTORING_KEY = 'trash_restoring_until';
/** Folders recreated by a restore (id -> time), so a later restore merges into them. */
export const TRASH_RECREATED_KEY = 'trash_recreated_folders';
/** chrome.storage.sync setting: record deletes made outside this extension (default true). */
export const TRASH_EXTERNAL_SETTING = 'trashExternal';

const MINUTE = 60 * 1000;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * MINUTE;
/** A restored entry lingers this long so a repeated Undo is a harmless no-op. */
export const RESTORED_KEEP_MS = 10 * MINUTE;
export const REQUEST_KEEP_MS = 10 * MINUTE;

export interface SavedNode {
    oldId: string;
    title: string;
    url?: string;
    dateAdded?: number;
    children?: SavedNode[];
}

export interface TrashScope {
    rootId: string;
    rootTitle: string;
    folderType?: string;
    syncing?: boolean;
}

/**
 * Where a delete came from; drives the Trash row wording. 'external' means it was
 * removed outside this extension (Chrome's bookmark manager, sync, another device).
 */
export type TrashOrigin = 'manual' | 'duplicate-finder' | 'external';

/** Folder colour and search visibility saved with a deleted folder (see folder_prefs.ts). */
export interface SavedFolderPref {
    color?: string;
    hideFromSearch?: true;
}

export interface TrashEntry {
    version: 1;
    entryId: string;
    operationId: string;
    origin: TrashOrigin;
    title: string;
    isFolder: boolean;
    bookmarkCount: number;
    nodeCount: number;
    deletedAt: number;
    expiresAt: number;
    parentId: string;
    index: number;
    /** Root first, ending with the direct parent. */
    ancestors: Array<{ oldId: string; title: string }>;
    scope: TrashScope;
    tree: SavedNode;
    /** Folder prefs of folders in `tree`, keyed by their old id. */
    folderPrefs?: Record<string, SavedFolderPref>;
    /** External deletes: event order inside the operation (restore goes in reverse). */
    seq?: number;
}

export type TrashState = 'prepared' | 'deleted' | 'restoring' | 'restored' | 'failed';

export interface RestoredTo {
    parentId: string;
    rootId: string;
    path: string[];
}

export interface TrashProgress {
    entryId: string;
    state: TrashState;
    updatedAt: number;
    /** Set on the first restore attempt and kept across retries (resume window). */
    restoreStartedAt?: number;
    created?: number;
    error?: string;
    /** The original location is gone; the user has to pick a destination. */
    needsDestination?: boolean;
    restoredTo?: RestoredTo;
    /** Root node created by an unfinished restore; a retry to another folder moves it there. */
    partialRootId?: string;
    /** Restored entries are purged after this time. */
    keepUntil?: number;
}

export interface TrashItem {
    entry: TrashEntry;
    progress: TrashProgress;
}

export interface TrashOperation {
    operationId: string;
    origin: TrashOrigin;
    deletedAt: number;
    expiresAt: number;
    items: TrashItem[];
    /** Bookmarks across the operation's entries that are still in Trash. */
    bookmarkCount: number;
}

// ─── Message contract ─────────────────────────────────────────────────────────

export type TrashRejectReason = 'permanent' | 'managed';

export interface TrashDeleteResult {
    ok: boolean;
    operationId?: string;
    entryIds?: string[];
    /** Bookmarks removed (a folder counts its bookmarks). */
    removedCount?: number;
    /** Roots removed (bookmarks or folders). */
    removedRoots?: number;
    /** Title of the single removed root, for the toast. */
    firstTitle?: string;
    skipped?: string[];
    failed?: Array<{ id: string; error: string }>;
    rejected?: Array<{ id: string; title: string; reason: TrashRejectReason }>;
    error?: string;
}

export interface TrashRestoreItemResult {
    entryId: string;
    state: TrashState;
    restoredTo?: RestoredTo;
    error?: string;
    needsDestination?: boolean;
}

export interface TrashRestoreResult {
    ok: boolean;
    results?: TrashRestoreItemResult[];
    restoredCount?: number;
    failedCount?: number;
    error?: string;
}

export interface TrashEmptyResult {
    ok: boolean;
    removedEntries?: number;
    removedBookmarks?: number;
    /** Entries left in place (mid-restore); reconcile normally settles these first. */
    keptEntries?: number;
    error?: string;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

export const entryKey = (entryId: string) => `${TRASH_ENTRY_PREFIX}${entryId}`;
export const progressKey = (entryId: string) => `${TRASH_PROGRESS_PREFIX}${entryId}`;
export const requestKey = (requestId: string) => `${TRASH_REQUEST_PREFIX}${requestId}`;

type StorageWithGetKeys = chrome.storage.LocalStorageArea & { getKeys?: () => Promise<string[]> };

/**
 * Every key in chrome.storage.local. Uses getKeys() (Chrome 130+) so previews are
 * never read; falls back to get(null) on older Chrome.
 */
export async function listLocalKeys(): Promise<string[]> {
    const area = chrome.storage.local as StorageWithGetKeys;
    if (typeof area.getKeys === 'function') {
        try {
            return await area.getKeys();
        } catch {
            // fall through to the slow path
        }
    }
    return Object.keys(await chrome.storage.local.get(null));
}

/** All trash entries with their progress, entries without progress are skipped. */
export async function readTrash(): Promise<TrashItem[]> {
    const keys = await listLocalKeys();
    const entryKeys = keys.filter(k => k.startsWith(TRASH_ENTRY_PREFIX));
    if (entryKeys.length === 0) return [];
    const ids = entryKeys.map(k => k.slice(TRASH_ENTRY_PREFIX.length));
    const data = await chrome.storage.local.get([...entryKeys, ...ids.map(progressKey)]);
    const items: TrashItem[] = [];
    for (const id of ids) {
        const entry = data[entryKey(id)] as TrashEntry | undefined;
        const progress = data[progressKey(id)] as TrashProgress | undefined;
        if (!isTrashEntry(entry) || !progress || typeof progress.state !== 'string') continue;
        items.push({ entry, progress });
    }
    return items;
}

export function isTrashEntry(value: unknown): value is TrashEntry {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Partial<TrashEntry>;
    return v.version === 1 && typeof v.entryId === 'string' && typeof v.operationId === 'string'
        && typeof v.tree === 'object' && v.tree !== null;
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

/** Old ids of every folder in a saved subtree. */
export function folderIds(node: SavedNode, out: string[] = []): string[] {
    if (!node.url) out.push(node.oldId);
    for (const c of node.children ?? []) folderIds(c, out);
    return out;
}

/** Every bookmark URL in a saved subtree, in order, de-duplicated. */
export function collectUrls(node: SavedNode, out: Set<string> = new Set()): Set<string> {
    if (node.url) out.add(node.url);
    for (const c of node.children ?? []) collectUrls(c, out);
    return out;
}

/** The first `n` bookmark URLs of a subtree (depth first), for preview strips. */
export function firstUrls(node: SavedNode, n: number): string[] {
    const out: string[] = [];
    const walk = (x: SavedNode) => {
        if (out.length >= n) return;
        if (x.url) out.push(x.url);
        for (const c of x.children ?? []) walk(c);
    };
    walk(node);
    return out;
}

export function countSaved(node: SavedNode): { bookmarks: number; nodes: number } {
    let bookmarks = node.url ? 1 : 0;
    let nodes = 1;
    for (const c of node.children ?? []) {
        const r = countSaved(c);
        bookmarks += r.bookmarks;
        nodes += r.nodes;
    }
    return { bookmarks, nodes };
}

/** Items still in Trash: not restored, and not a half-written delete. */
export function isInTrash(item: TrashItem): boolean {
    return item.progress.state === 'deleted' || item.progress.state === 'failed' || item.progress.state === 'restoring';
}

/** Badge number: bookmarks in Trash, an empty folder counting as one item. */
export function trashBadgeCount(items: TrashItem[]): number {
    let n = 0;
    for (const item of items) if (isInTrash(item)) n += Math.max(1, item.entry.bookmarkCount);
    return n;
}

/** Group items into operations, newest first; entries inside keep original order. */
export function groupOperations(items: TrashItem[]): TrashOperation[] {
    const byOp = new Map<string, TrashItem[]>();
    for (const item of items) {
        if (!isInTrash(item)) continue;
        const list = byOp.get(item.entry.operationId) ?? [];
        list.push(item);
        byOp.set(item.entry.operationId, list);
    }
    const ops: TrashOperation[] = [];
    for (const [operationId, list] of byOp) {
        list.sort((a, b) => a.entry.index - b.entry.index || a.entry.title.localeCompare(b.entry.title));
        ops.push({
            operationId,
            origin: list[0].entry.origin,
            deletedAt: Math.max(...list.map(i => i.entry.deletedAt)),
            expiresAt: Math.min(...list.map(i => i.entry.expiresAt)),
            items: list,
            bookmarkCount: list.reduce((n, i) => n + Math.max(1, i.entry.bookmarkCount), 0),
        });
    }
    ops.sort((a, b) => b.deletedAt - a.deletedAt);
    return ops;
}

/** "Bookmarks bar › Work › Recipes" for an entry's original location. */
export function entryPath(entry: TrashEntry): string {
    return entry.ancestors.map(a => a.title || 'Untitled folder').join(' › ');
}
