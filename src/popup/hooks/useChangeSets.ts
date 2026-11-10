// SPDX-License-Identifier: AGPL-3.0-only
//
// Page side of AI changes: talks to the worker's change-set coordinator
// (src/sw/change_sets.ts) and refreshes on CS_CHANGED.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeOp } from '../../lib/change_set/format';
import type { OpVerdict } from '../../lib/change_set/validate';
import type { ChangeSetRecord, ChangeSetSummary, JournalItem } from '../../sw/change_sets';

export type ImportResult =
    | { ok: true; id: string }
    | { ok: false; error: string; verdicts?: OpVerdict[]; ops?: ChangeOp[] };

async function send<T>(message: Record<string, unknown>): Promise<T> {
    // The worker may be asleep: one retry after a short wait.
    for (let attempt = 0; ; attempt++) {
        try {
            return await chrome.runtime.sendMessage(message) as T;
        } catch (err) {
            if (attempt >= 1) throw err;
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

export interface ChangeSetsApi {
    sets: ChangeSetSummary[];
    loading: boolean;
    pendingCount: number;
    busyId: string | null;
    refresh: () => Promise<void>;
    get: (id: string) => Promise<{ set: ChangeSetRecord; items: JournalItem[] } | null>;
    registerSnapshot: (folderIds: string[]) => Promise<string | null>;
    importText: (text: string, source: { kind: 'paste' | 'file'; name?: string }) => Promise<ImportResult>;
    apply: (id: string, selected: number[]) => Promise<{ ok: boolean; error?: string }>;
    finish: (id: string) => Promise<{ ok: boolean; error?: string }>;
    undo: (id: string) => Promise<{ ok: boolean; error?: string; undone?: number; skipped?: number }>;
    reject: (id: string) => Promise<{ ok: boolean; error?: string }>;
    /** Bumps whenever the worker reports a change (open detail views reload on it). */
    version: number;
}

export function useChangeSets(enabled = true): ChangeSetsApi {
    const [sets, setSets] = useState<ChangeSetSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [version, setVersion] = useState(0);
    const alive = useRef(true);

    const refresh = useCallback(async () => {
        if (!enabled) { setLoading(false); return; }
        try {
            const res = await send<{ ok: boolean; sets?: ChangeSetSummary[] }>({ type: 'CS_LIST' });
            if (alive.current && res?.ok) setSets(res.sets ?? []);
        } catch {
            // Worker unavailable; keep what we have.
        } finally {
            if (alive.current) setLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        alive.current = true;
        void refresh();
        const onMessage = (m: unknown) => {
            if ((m as { type?: string })?.type === 'CS_CHANGED') {
                setVersion(v => v + 1);
                void refresh();
            }
        };
        chrome.runtime.onMessage.addListener(onMessage);
        return () => { alive.current = false; chrome.runtime.onMessage.removeListener(onMessage); };
    }, [refresh]);

    const withBusy = useCallback(async <T,>(id: string, job: () => Promise<T>): Promise<T> => {
        setBusyId(id);
        try { return await job(); } finally {
            if (alive.current) setBusyId(null);
            void refresh();
        }
    }, [refresh]);

    const failure = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) });

    return {
        sets,
        loading,
        pendingCount: sets.filter(s => s.state === 'pending').length,
        busyId,
        version,
        refresh,
        get: async (id) => {
            const res = await send<{ ok: boolean; set?: ChangeSetRecord; items?: JournalItem[] }>({ type: 'CS_GET', id }).catch(() => null);
            return res?.ok && res.set ? { set: res.set, items: res.items ?? [] } : null;
        },
        registerSnapshot: async (folderIds) => {
            const res = await send<{ ok: boolean; snapshotId?: string }>({ type: 'CS_SNAPSHOT', folderIds }).catch(() => null);
            return res?.ok ? res.snapshotId ?? null : null;
        },
        importText: async (text, source) => {
            try {
                const res = await send<ImportResult>({ type: 'CS_IMPORT', text, sourceKind: source.kind, sourceName: source.name });
                void refresh();
                return res ?? { ok: false, error: 'No answer from the extension. Try again.' };
            } catch (err) { return failure(err); }
        },
        apply: (id, selected) => withBusy(id, () => send<{ ok: boolean; error?: string }>({ type: 'CS_APPLY', id, selected }).catch(failure)),
        finish: (id) => withBusy(id, () => send<{ ok: boolean; error?: string }>({ type: 'CS_FINISH', id }).catch(failure)),
        undo: (id) => withBusy(id, () => send<{ ok: boolean; error?: string; undone?: number; skipped?: number }>({ type: 'CS_UNDO', id }).catch(failure)),
        reject: (id) => withBusy(id, () => send<{ ok: boolean; error?: string }>({ type: 'CS_REJECT', id }).catch(failure)),
    };
}
