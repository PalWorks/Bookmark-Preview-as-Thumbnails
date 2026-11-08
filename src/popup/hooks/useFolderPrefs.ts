// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import { readFolderPrefs, type FolderPrefPatch, type FolderPrefs } from '../../lib/folder_prefs';

/**
 * Folder colours and "hidden from search", read from storage and refreshed when the
 * worker says they changed (FOLDER_PREFS_CHANGED) or Trash changed (a restore can
 * bring prefs back). Writes go through the worker, the only writer of these keys.
 */
export function useFolderPrefs() {
    const [prefs, setPrefs] = useState<FolderPrefs>({});
    const [rev, setRev] = useState(0);

    useEffect(() => {
        let cancelled = false;
        readFolderPrefs()
            .then(p => { if (!cancelled) setPrefs(p); })
            .catch(err => console.error('[FolderPrefs] load failed', err));
        return () => { cancelled = true; };
    }, [rev]);

    useEffect(() => {
        const onMessage = (m: { type?: string }) => {
            if (m?.type === 'FOLDER_PREFS_CHANGED' || m?.type === 'TRASH_CHANGED') setRev(n => n + 1);
        };
        chrome.runtime.onMessage.addListener(onMessage);
        return () => chrome.runtime.onMessage.removeListener(onMessage);
    }, []);

    /** Change prefs; resolves false when the worker refused or could not be reached. */
    const update = useCallback(async (ids: string[], patch: FolderPrefPatch): Promise<boolean> => {
        try {
            const res = await chrome.runtime.sendMessage({ type: 'FOLDER_PREFS_SET', ids, patch }) as { ok?: boolean } | undefined;
            // Refresh now rather than waiting for the broadcast.
            setRev(n => n + 1);
            return !!res?.ok;
        } catch (err) {
            console.error('[FolderPrefs] save failed', err);
            return false;
        }
    }, []);

    return { prefs, update };
}
