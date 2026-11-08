// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type HistoryPermission = 'checking' | 'granted' | 'not-granted';

export interface HistoryStat {
    visits: number;
    lastVisit?: number;
}

const PERMISSION: chrome.permissions.Permissions = { permissions: ['history'] };
const CONCURRENCY = 8;

/**
 * Visits and last visit from Chrome's history, for the links on screen. Uses the
 * optional `history` permission: nothing is read until the user allows it, and
 * nothing is stored. Counts are per exact URL, within the history Chrome keeps.
 */
export function useHistoryStats(urls: string[], wanted: boolean) {
    const [permission, setPermission] = useState<HistoryPermission>('checking');
    const [stats, setStats] = useState<Record<string, HistoryStat>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    // Session cache: a URL's counts are read once per page load.
    const cache = useRef(new Map<string, HistoryStat>());
    const key = useMemo(() => [...new Set(urls)].sort().join('\n'), [urls]);

    const check = useCallback(async () => {
        try {
            const has = await chrome.permissions.contains(PERMISSION);
            setPermission(has ? 'granted' : 'not-granted');
            if (!has) cache.current.clear();
        } catch {
            setPermission('not-granted');
        }
    }, []);

    useEffect(() => {
        void check();
        const onChange = () => { void check(); };
        chrome.permissions?.onAdded?.addListener(onChange);
        chrome.permissions?.onRemoved?.addListener(onChange);
        return () => {
            chrome.permissions?.onAdded?.removeListener(onChange);
            chrome.permissions?.onRemoved?.removeListener(onChange);
        };
    }, [check]);

    useEffect(() => {
        if (!wanted || permission !== 'granted' || !key || !chrome.history) return;
        let cancelled = false;
        const list = key.split('\n');
        const missing = list.filter(u => !cache.current.has(u));
        const publish = () => {
            const out: Record<string, HistoryStat> = {};
            for (const u of list) { const s = cache.current.get(u); if (s) out[u] = s; }
            setStats(out);
        };
        if (missing.length === 0) { publish(); return; }
        setLoading(true);
        setError(false);
        const run = async () => {
            let failed = false;
            for (let i = 0; i < missing.length && !cancelled; i += CONCURRENCY) {
                await Promise.all(missing.slice(i, i + CONCURRENCY).map(async url => {
                    try {
                        const visits = await chrome.history.getVisits({ url });
                        const last = visits.reduce((m, v) => Math.max(m, v.visitTime ?? 0), 0);
                        cache.current.set(url, { visits: visits.length, lastVisit: last || undefined });
                    } catch {
                        failed = true;
                    }
                }));
            }
            if (cancelled) return;
            publish();
            setError(failed);
            setLoading(false);
        };
        void run();
        return () => { cancelled = true; };
    }, [wanted, permission, key]);

    /**
     * Ask Chrome for the history permission. Must be called straight from a click
     * handler (Chrome needs the user gesture), before any other await.
     */
    const request = useCallback(async (): Promise<boolean> => {
        try {
            const granted: boolean = await (chrome.permissions.request(PERMISSION) as unknown as Promise<boolean>);
            setPermission(granted ? 'granted' : 'not-granted');
            return granted;
        } catch {
            setPermission('not-granted');
            return false;
        }
    }, []);

    /** Give the permission back (when the user turns both history columns off). */
    const release = useCallback(async () => {
        try {
            await chrome.permissions.remove(PERMISSION);
        } finally {
            cache.current.clear();
            setStats({});
            void check();
        }
    }, [check]);

    const granted = permission === 'granted';
    return { permission, stats: granted ? stats : {}, loading: granted && loading, error: granted && error, request, release };
}
