// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MetadataRecord } from '../../lib/storage_index';
import { patchMetadata } from '../../lib/metadata_client';

export interface LinkMeta {
    rating?: number;
    lastOpenedAt?: number;
}

/**
 * Rating and "opened" time for the links on screen (meta_<url>, keyed by the
 * bookmark URL). Reads only those records, never the whole storage (previews live
 * there too). Refreshes a URL when the worker broadcasts META_UPDATED.
 */
export function useLinkMeta(urls: string[]) {
    const key = useMemo(() => [...new Set(urls)].sort().join('\n'), [urls]);
    const [meta, setMeta] = useState<Record<string, LinkMeta>>({});
    const [updated, setUpdated] = useState<{ rev: number; urls: string[] }>({ rev: 0, urls: [] });

    // Read the given links' records and merge them in (replace: start from empty).
    const load = useCallback(async (list: string[], replace: boolean, isCancelled: () => boolean) => {
        const data = list.length ? await chrome.storage.local.get(list.map(u => `meta_${u}`)) : {};
        if (isCancelled()) return;
        setMeta(prev => {
            const next: Record<string, LinkMeta> = replace ? {} : { ...prev };
            for (const u of list) {
                const rec = data[`meta_${u}`] as MetadataRecord | undefined;
                if (rec && (rec.rating || rec.lastOpenedAt)) next[u] = { rating: rec.rating, lastOpenedAt: rec.lastOpenedAt };
                else delete next[u];
            }
            return next;
        });
    }, []);

    // The links on screen changed: read them all.
    useEffect(() => {
        let cancelled = false;
        load(key ? key.split('\n') : [], true, () => cancelled).catch(err => console.error('[LinkMeta] load failed', err));
        return () => { cancelled = true; };
    }, [key, load]);

    // Another page or the worker changed some links: re-read those that are on screen.
    useEffect(() => {
        if (updated.rev === 0) return;
        if (updated.urls.length === 0) return;
        const onScreen = new Set(key ? key.split('\n') : []);
        const pending = updated.urls;
        const list = pending.filter(u => onScreen.has(u));
        let cancelled = false;
        // Drain what this pass handles (links not on screen are re-read when they appear).
        const drain = () => setUpdated(d => ({ rev: d.rev, urls: d.urls.filter(u => !pending.includes(u)) }));
        if (list.length === 0) { Promise.resolve().then(() => { if (!cancelled) drain(); }); return () => { cancelled = true; }; }
        load(list, false, () => cancelled)
            .then(() => { if (!cancelled) drain(); })
            .catch(err => console.error('[LinkMeta] refresh failed', err));
        return () => { cancelled = true; };
        // Only on a new broadcast; `key` changes are covered by the full load above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updated, load]);

    useEffect(() => {
        const onMessage = (m: { type?: string; urls?: unknown }) => {
            if (m?.type !== 'META_UPDATED' || !Array.isArray(m.urls)) return;
            const urls = m.urls.filter((u): u is string => typeof u === 'string');
            // Add to the pending list: two broadcasts before a render must both refresh.
            setUpdated(d => ({ rev: d.rev + 1, urls: [...new Set([...d.urls, ...urls])] }));
        };
        chrome.runtime.onMessage.addListener(onMessage);
        return () => chrome.runtime.onMessage.removeListener(onMessage);
    }, []);

    /** Set (1 to 5) or clear (null) a link's rating. Throws when it could not be saved. */
    const setRating = useCallback(async (url: string, rating: number | null) => {
        await patchMetadata(url, { rating });
        setMeta(prev => {
            const next = { ...prev };
            const cur = { ...(next[url] ?? {}) };
            if (rating === null) delete cur.rating; else cur.rating = rating;
            if (cur.rating || cur.lastOpenedAt) next[url] = cur; else delete next[url];
            return next;
        });
    }, []);

    /** Record that links were opened from this extension (best effort, never throws). */
    const markOpened = useCallback((opened: string[]) => {
        const at = Date.now();
        for (const url of new Set(opened)) {
            setMeta(prev => ({ ...prev, [url]: { ...(prev[url] ?? {}), lastOpenedAt: at } }));
            patchMetadata(url, { lastOpenedAt: at }).catch(err => console.warn('[LinkMeta] could not record open', url, err));
        }
    }, []);

    return { meta, setRating, markOpened };
}
