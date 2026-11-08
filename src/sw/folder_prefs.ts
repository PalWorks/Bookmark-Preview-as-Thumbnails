// SPDX-License-Identifier: AGPL-3.0-only
//
// Folder prefs writer. Runs in the service worker and is the only writer of
// fpref_<folderId> keys (two open tabs changing different fields of one folder
// would otherwise overwrite each other). No import side effects: sw.ts creates the
// service and routes FOLDER_PREFS_SET to it.

import {
    folderPrefKey, readFolderPrefs, readFolderPrefsFor, applyFolderPrefPatch, sanitizeFolderPrefPatch,
    sanitizeFolderPref, type FolderPref, type FolderPrefPatch, type FolderPrefs,
} from '../lib/folder_prefs';
import { getNode, ROOT_ID } from '../lib/bookmark_tree';

/** Folders changed by one message; Select all in a big view stays well under this. */
const MAX_IDS = 5000;

export interface FolderPrefsServiceDeps {
    broadcast?: (message: { type: 'FOLDER_PREFS_CHANGED'; ids: string[] }) => void;
}

export function createFolderPrefsService(deps: FolderPrefsServiceDeps = {}) {
    const broadcast = deps.broadcast ?? ((message) => {
        chrome.runtime.sendMessage(message).catch(() => { /* no extension page open */ });
    });
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
        const run = queue.catch(() => undefined).then(fn);
        queue = run.catch(() => undefined);
        return run;
    };

    /** Change prefs of existing, non-root folders. Unknown or non-folder ids are skipped. */
    async function setNow(ids: string[], patch: FolderPrefPatch): Promise<{ ok: true; changed: string[]; skipped: string[] }> {
        const changed: string[] = [];
        const skipped: string[] = [];
        const current = await readFolderPrefsFor(ids);
        const toSet: Record<string, FolderPref> = {};
        const toRemove: string[] = [];
        for (const id of ids) {
            const node = await getNode(id);
            if (!node || node.url || node.id === ROOT_ID) { skipped.push(id); continue; }
            const next = applyFolderPrefPatch(current[id], patch);
            if (next) toSet[folderPrefKey(id)] = next; else toRemove.push(folderPrefKey(id));
            changed.push(id);
        }
        if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
        if (toRemove.length) await chrome.storage.local.remove(toRemove);
        if (changed.length) broadcast({ type: 'FOLDER_PREFS_CHANGED', ids: changed });
        return { ok: true, changed, skipped };
    }

    /** Write saved prefs onto new folder ids (Trash restore). Existing prefs win. */
    async function applySnapshotNow(map: Array<{ newId: string; pref: unknown }>): Promise<void> {
        if (map.length === 0) return;
        const current = await readFolderPrefsFor(map.map(m => m.newId));
        const toSet: Record<string, FolderPref> = {};
        for (const { newId, pref } of map) {
            const clean = sanitizeFolderPref(pref);
            if (!clean || current[newId]) continue;
            toSet[folderPrefKey(newId)] = clean;
        }
        if (Object.keys(toSet).length === 0) return;
        await chrome.storage.local.set(toSet);
        broadcast({ type: 'FOLDER_PREFS_CHANGED', ids: map.map(m => m.newId) });
    }

    /**
     * Remove prefs of folders that no longer exist. Trash entries keep their own
     * copy, so this never loses a pref Undo could bring back. Daily alarm only.
     */
    async function pruneNow(): Promise<number> {
        const prefs: FolderPrefs = await readFolderPrefs();
        const gone: string[] = [];
        for (const id of Object.keys(prefs)) {
            if (!(await getNode(id))) gone.push(id);
        }
        if (gone.length) await chrome.storage.local.remove(gone.map(folderPrefKey));
        return gone.length;
    }

    return {
        set: (ids: string[], patch: FolderPrefPatch) => enqueue(() => setNow(ids, patch)),
        applySnapshot: (map: Array<{ newId: string; pref: unknown }>) => enqueue(() => applySnapshotNow(map)),
        prune: () => enqueue(() => pruneNow()),
    };
}

export type FolderPrefsService = ReturnType<typeof createFolderPrefsService>;

/** Validate and run FOLDER_PREFS_SET from an extension page. */
export async function handleFolderPrefsMessage(
    service: FolderPrefsService,
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
): Promise<unknown> {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) {
        return { ok: false, error: 'FOLDER_PREFS_SET rejected: not an extension page' };
    }
    const ids = message.ids;
    const patch = sanitizeFolderPrefPatch(message.patch);
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS
        || !ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200) || !patch) {
        return { ok: false, error: 'Invalid FOLDER_PREFS_SET message' };
    }
    return service.set([...new Set(ids as string[])], patch);
}
