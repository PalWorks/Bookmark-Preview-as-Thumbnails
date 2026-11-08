// SPDX-License-Identifier: AGPL-3.0-only
//
// Per-folder preferences (colour, hidden from search). DOM-free and React-free so
// the service worker can use it.
//
// Storage: chrome.storage.local, one key per folder, fpref_<folderId>. Bookmark ids
// are local to one device, so these never go to sync storage; exports carry them by
// folder path instead (backup_manager). Only the service worker writes these keys
// (src/sw/folder_prefs.ts); pages send FOLDER_PREFS_SET and refresh on
// FOLDER_PREFS_CHANGED.

import { listLocalKeys } from './trash_store';

export const FOLDER_PREF_PREFIX = 'fpref_';
export const folderPrefKey = (folderId: string) => `${FOLDER_PREF_PREFIX}${folderId}`;

/** Named colours; 'yellow' is the default and is never stored. */
export const FOLDER_COLORS = ['orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'grey'] as const;
export type FolderColor = typeof FOLDER_COLORS[number];

export const FOLDER_COLOR_LABELS: Record<FolderColor | 'default', string> = {
    default: 'Yellow (default)',
    orange: 'Orange',
    red: 'Red',
    pink: 'Pink',
    purple: 'Purple',
    blue: 'Blue',
    teal: 'Teal',
    green: 'Green',
    grey: 'Grey',
};

export interface FolderPref {
    color?: FolderColor;
    hideFromSearch?: true;
}

/** A change sent by a page: null clears the colour, false shows the folder in search again. */
export interface FolderPrefPatch {
    color?: FolderColor | null;
    hideFromSearch?: boolean;
}

export type FolderPrefs = Record<string, FolderPref>;

export function isFolderColor(v: unknown): v is FolderColor {
    return typeof v === 'string' && (FOLDER_COLORS as readonly string[]).includes(v);
}

/** A stored or imported pref, cleaned; undefined when nothing valid is left. */
export function sanitizeFolderPref(raw: unknown): FolderPref | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const out: FolderPref = {};
    if (isFolderColor(r.color)) out.color = r.color;
    if (r.hideFromSearch === true) out.hideFromSearch = true;
    return out.color || out.hideFromSearch ? out : undefined;
}

/** A page's patch, cleaned; undefined when it changes nothing valid. */
export function sanitizeFolderPrefPatch(raw: unknown): FolderPrefPatch | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const out: FolderPrefPatch = {};
    if (r.color === null || isFolderColor(r.color)) out.color = r.color;
    if (typeof r.hideFromSearch === 'boolean') out.hideFromSearch = r.hideFromSearch;
    return Object.keys(out).length ? out : undefined;
}

/** Apply a patch to a pref; undefined means "no pref left" (remove the key). */
export function applyFolderPrefPatch(current: FolderPref | undefined, patch: FolderPrefPatch): FolderPref | undefined {
    const next: FolderPref = { ...(current ?? {}) };
    if (patch.color === null) delete next.color;
    else if (patch.color !== undefined) next.color = patch.color;
    if (patch.hideFromSearch === false) delete next.hideFromSearch;
    else if (patch.hideFromSearch === true) next.hideFromSearch = true;
    return sanitizeFolderPref(next);
}

/** Every stored folder pref, keyed by folder id. */
export async function readFolderPrefs(): Promise<FolderPrefs> {
    const keys = (await listLocalKeys()).filter(k => k.startsWith(FOLDER_PREF_PREFIX));
    if (keys.length === 0) return {};
    const data = await chrome.storage.local.get(keys);
    const out: FolderPrefs = {};
    for (const k of keys) {
        const pref = sanitizeFolderPref(data[k]);
        if (pref) out[k.slice(FOLDER_PREF_PREFIX.length)] = pref;
    }
    return out;
}

/** Prefs for the given folder ids only (missing ones omitted). */
export async function readFolderPrefsFor(ids: string[]): Promise<FolderPrefs> {
    if (ids.length === 0) return {};
    const data = await chrome.storage.local.get(ids.map(folderPrefKey));
    const out: FolderPrefs = {};
    for (const id of ids) {
        const pref = sanitizeFolderPref(data[folderPrefKey(id)]);
        if (pref) out[id] = pref;
    }
    return out;
}

/** Ids of folders hidden from search. */
export function hiddenFolderIds(prefs: FolderPrefs): Set<string> {
    return new Set(Object.entries(prefs).filter(([, p]) => p.hideFromSearch).map(([id]) => id));
}

/**
 * True when the node sits inside a hidden folder (or is one). `parentOf` maps a
 * node id to its parent id; unknown ids end the walk.
 */
export function isInHiddenFolder(id: string, parentOf: Map<string, string>, hidden: Set<string>): boolean {
    if (hidden.size === 0) return false;
    let cur: string | undefined = id;
    for (let guard = 0; cur && guard < 256; guard++) {
        if (hidden.has(cur)) return true;
        cur = parentOf.get(cur);
    }
    return false;
}

/** The nearest hidden ancestor (not the node itself), for "Hidden with <folder>". */
export function hiddenAncestor(id: string, parentOf: Map<string, string>, hidden: Set<string>): string | undefined {
    let cur = parentOf.get(id);
    for (let guard = 0; cur && guard < 256; guard++) {
        if (hidden.has(cur)) return cur;
        cur = parentOf.get(cur);
    }
    return undefined;
}

/** Parent map of a bookmark tree (id -> parentId). */
export function buildParentMap(roots: chrome.bookmarks.BookmarkTreeNode[]): Map<string, string> {
    const map = new Map<string, string>();
    const walk = (n: chrome.bookmarks.BookmarkTreeNode) => {
        if (n.parentId) map.set(n.id, n.parentId);
        for (const c of n.children ?? []) walk(c);
    };
    roots.forEach(walk);
    return map;
}
