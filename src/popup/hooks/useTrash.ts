// SPDX-License-Identifier: AGPL-3.0-only
//
// Popup side of Trash. Reads trash_* records directly (cheap, via getKeys) and
// sends every mutation to the service worker, which is the only writer. Refreshes
// on TRASH_CHANGED broadcasts rather than raw storage.onChanged payloads, which
// would also deliver every preview image written by captures.

import { useEffect, useState } from 'react';
import {
    readTrash, groupOperations, trashBadgeCount,
    type TrashItem, type TrashOrigin, type TrashDeleteResult, type TrashRestoreResult, type TrashEmptyResult,
} from '../../lib/trash_store';
import { truncateTitle, plural } from '../../lib/utils';
import type { ToastApi } from './useToast';

const CONNECTION_ERROR = /Receiving end does not exist|Could not establish connection|message port closed/i;

function newRequestId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Send a TRASH_* message. A sleeping worker sometimes misses the first message;
 * retry once. The requestId makes the retry a no-op if the first one did land.
 */
export async function sendTrashMessage<T>(message: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await chrome.runtime.sendMessage(message);
            if (res === undefined) throw new Error('The extension did not answer. Reload this page and try again.');
            return res as T;
        } catch (err) {
            if (attempt === 0 && CONNECTION_ERROR.test(String(err))) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
            throw err;
        }
    }
}

export interface DeleteTarget {
    id: string;
    title: string;
}

export interface DeleteOptions {
    origin?: TrashOrigin;
    /** Called with the result after a delete that removed something. */
    onDeleted?: (result: TrashDeleteResult) => void;
}

interface UseTrashDeps {
    toast: ToastApi;
    /** Open a folder (used by "Open folder" after a restore). */
    onOpenFolder: (folderId: string) => void;
    /** Show the Trash panel. */
    onOpenTrash: () => void;
    /** Focus a restored bookmark or folder once it is visible. */
    onRestoredFocus?: (nodeId: string) => void;
    /** Incognito page: the incognito worker cannot write Trash. */
    readOnly: boolean;
}

function describeRemoved(res: TrashDeleteResult, targets: DeleteTarget[], origin: TrashOrigin): string {
    const roots = res.removedRoots ?? 0;
    const failed = res.failed?.length ?? 0;
    if (failed > 0) {
        return `Deleted ${roots} of ${roots + failed}. ${plural(failed, 'item')} couldn't be deleted.`;
    }
    if (origin === 'duplicate-finder') return `Removed ${plural(roots, 'duplicate')}`;
    if (roots === 1) {
        const title = truncateTitle(res.firstTitle ?? targets[0]?.title ?? '');
        const count = res.removedCount ?? 0;
        return count > 1 ? `Deleted '${title}' (${plural(count, 'bookmark')})` : `Deleted '${title}'`;
    }
    return `Deleted ${plural(roots, 'item')}`;
}

export function useTrash({ toast, onOpenFolder, onOpenTrash, onRestoredFocus, readOnly }: UseTrashDeps) {
    const [items, setItems] = useState<TrashItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
    const [busyOps, setBusyOps] = useState<Set<string>>(new Set());
    const [emptying, setEmptying] = useState(false);
    const [loadSeq, setLoadSeq] = useState(0);

    // (Re)load whenever loadSeq changes; TRASH_CHANGED and reload() bump it.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const next = await readTrash();
                if (cancelled) return;
                setItems(next);
                setLoadError(null);
            } catch (err) {
                if (cancelled) return;
                console.error('[Trash] load failed', err);
                setLoadError("Couldn't load Trash.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [loadSeq]);

    useEffect(() => {
        const listener = (message: { type?: string }) => {
            if (message?.type === 'TRASH_CHANGED') setLoadSeq(n => n + 1);
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    const reload = () => setLoadSeq(n => n + 1);

    const markOp = (opId: string, busy: boolean) => setBusyOps(prev => {
        const s = new Set(prev);
        if (busy) s.add(opId); else s.delete(opId);
        return s;
    });

    const restoreMessage = (res: TrashRestoreResult): { message: string; tone: 'success' | 'error'; folderId?: string; needsDestination: boolean; rootId?: string } => {
        const results = res.results ?? [];
        const ok = results.filter(r => r.state === 'restored');
        const failed = results.filter(r => r.state === 'failed');
        const needsDestination = failed.some(r => r.needsDestination);
        if (!res.ok && ok.length === 0) {
            if (needsDestination) return { message: "Couldn't put it back where it was. Choose a folder in Trash.", tone: 'error', needsDestination };
            return { message: failed[0]?.error ?? res.error ?? "Couldn't restore. Try again from Trash.", tone: 'error', needsDestination };
        }
        const to = ok[0]?.restoredTo;
        const where = to?.path.length ? to.path.join(' › ') : 'its folder';
        if (failed.length) {
            return { message: `${ok.length} of ${results.length} restored. Retry the rest in Trash.`, tone: 'error', folderId: to?.parentId, needsDestination, rootId: to?.rootId };
        }
        return { message: `Restored to ${where}`, tone: 'success', folderId: to?.parentId, needsDestination: false, rootId: to?.rootId };
    };

    /**
     * Restore an operation (Undo, Restore all) or one entry. `toastId` continues an
     * existing toast (Undo) instead of opening a new one.
     */
    const restore = async (
        target: { operationId: string } | { entryId: string; operationId: string },
        targetParentId?: string,
        toastId?: number,
    ): Promise<TrashRestoreResult | undefined> => {
        const opId = target.operationId;
        if (readOnly) {
            toast.show({ message: 'Restore works in regular windows only.', tone: 'error' });
            return undefined;
        }
        markOp(opId, true);
        const id = toastId ?? toast.show({ message: 'Restoring…', busy: true, autoHideMs: 0 });
        if (toastId !== undefined) toast.update(id, { message: 'Restoring…', busy: true, actions: [], onUndo: undefined, autoHideMs: 0 });
        try {
            const res = await sendTrashMessage<TrashRestoreResult>({
                type: 'TRASH_RESTORE',
                ...('entryId' in target ? { entryId: target.entryId } : { operationId: opId }),
                ...(targetParentId ? { targetParentId } : {}),
            });
            const m = restoreMessage(res);
            const actions = [];
            if (m.folderId) actions.push({ label: 'Open folder', onClick: () => { onOpenFolder(m.folderId!); toast.dismiss(id); } });
            if (m.needsDestination || m.tone === 'error') actions.push({ label: 'View Trash', onClick: () => { onOpenTrash(); toast.dismiss(id); } });
            toast.replace(id, { message: m.message, tone: m.tone, actions, autoHideMs: 8000 });
            if (m.rootId && onRestoredFocus) onRestoredFocus(m.rootId);
            return res;
        } catch (err) {
            console.error('[Trash] restore failed', err);
            toast.replace(id, {
                message: "Couldn't restore. Try again from Trash.",
                tone: 'error',
                actions: [{ label: 'View Trash', onClick: () => { onOpenTrash(); toast.dismiss(id); } }],
                autoHideMs: 8000,
            });
            return undefined;
        } finally {
            markOp(opId, false);
            reload();
        }
    };

    const deleteItems = async (targets: DeleteTarget[], opts: DeleteOptions = {}): Promise<TrashDeleteResult | undefined> => {
        if (targets.length === 0) return undefined;
        if (readOnly) {
            toast.show({ message: 'Delete works in regular windows only. Open this page in a normal window.', tone: 'error' });
            return undefined;
        }
        const origin = opts.origin ?? 'manual';
        const ids = targets.map(t => t.id);
        setPendingIds(prev => new Set([...prev, ...ids]));
        const label = targets.length === 1 ? `'${truncateTitle(targets[0].title)}'` : plural(targets.length, 'item');
        const toastId = toast.show({ message: `Deleting ${label}…`, busy: true, autoHideMs: 0 });
        try {
            const res = await sendTrashMessage<TrashDeleteResult>({
                type: 'TRASH_DELETE', ids, origin, requestId: newRequestId(),
            });
            if (res.rejected?.length) {
                const r = res.rejected[0];
                const title = truncateTitle(r.title);
                const message = r.reason === 'managed'
                    ? `'${title}' is managed by your organisation and can't be deleted. Nothing was removed.`
                    : `'${title}' is a Chrome folder and can't be deleted. Nothing was removed.`;
                toast.replace(toastId, { message, tone: 'error' });
                return res;
            }
            if (!res.ok || !res.operationId) {
                const nothing = (res.removedRoots ?? 0) === 0 && !res.error && (res.skipped?.length ?? 0) > 0;
                toast.replace(toastId, {
                    message: nothing ? 'Already deleted.' : (res.error ?? `Couldn't delete ${label}. Nothing was removed.`),
                    tone: nothing ? 'info' : 'error',
                });
                return res;
            }
            const operationId = res.operationId;
            const undo = () => { void restore({ operationId }, undefined, toastId); };
            toast.replace(toastId, {
                message: describeRemoved(res, targets, origin),
                tone: res.failed?.length ? 'error' : 'info',
                actions: [
                    { label: 'Undo', onClick: undo, primary: true },
                    { label: 'View Trash', onClick: () => { onOpenTrash(); toast.dismiss(toastId); } },
                ],
                onUndo: undo,
                autoHideMs: 8000,
            });
            opts.onDeleted?.(res);
            return res;
        } catch (err) {
            console.error('[Trash] delete failed', err);
            toast.replace(toastId, { message: `Couldn't delete ${label}. Nothing was removed.`, tone: 'error' });
            return undefined;
        } finally {
            setPendingIds(prev => {
                const s = new Set(prev);
                ids.forEach(i => s.delete(i));
                return s;
            });
            reload();
        }
    };

    const empty = async (): Promise<TrashEmptyResult | undefined> => {
        if (readOnly) return undefined;
        setEmptying(true);
        try {
            const res = await sendTrashMessage<TrashEmptyResult>({ type: 'TRASH_EMPTY' });
            if (!res.ok) {
                toast.show({ message: res.error ?? "Couldn't empty Trash.", tone: 'error' });
            } else {
                toast.show({ message: 'Trash emptied', tone: 'success' });
            }
            return res;
        } catch (err) {
            console.error('[Trash] empty failed', err);
            toast.show({ message: "Couldn't empty Trash.", tone: 'error' });
            return undefined;
        } finally {
            setEmptying(false);
            reload();
        }
    };

    /** Drop expired entries now (also done daily by the worker). */
    const purgeExpired = async (): Promise<void> => {
        if (readOnly) return;
        try {
            await sendTrashMessage({ type: 'TRASH_PURGE' });
        } catch (err) {
            console.warn('[Trash] purge request failed', err);
        }
    };

    return {
        items,
        operations: groupOperations(items),
        badgeCount: trashBadgeCount(items),
        loading,
        loadError,
        pendingIds,
        busyOps,
        emptying,
        readOnly,
        reload,
        deleteItems,
        restore,
        empty,
        purgeExpired,
    };
}

export type TrashApi = ReturnType<typeof useTrash>;
