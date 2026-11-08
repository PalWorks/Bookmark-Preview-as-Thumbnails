// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { DEFAULT_LIST_COLUMNS, sanitizeListColumns, type ListColumn } from '../../lib/list_columns';

export function useSettings() {
    const [useIncognito, setUseIncognito] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
    const [captureDelay, setCaptureDelay] = useState<number>(500);
    const [useActiveTabCapture, setUseActiveTabCapture] = useState(false);
    // Desktop preference: hide the folder panel. Synced like the other settings.
    const [sidebarHidden, setSidebarHidden] = useState(false);
    // List view columns (1.4.0).
    const [listColumns, setListColumns] = useState<ListColumn[]>(DEFAULT_LIST_COLUMNS);
    // Keep deletes made outside this extension in Trash (1.4.0, default on).
    const [trashExternal, setTrashExternal] = useState(true);
    // Bumped by reloadSettings() (after a settings import).
    const [loadSeq, setLoadSeq] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const result = await chrome.storage.sync.get(
                ['useIncognito', 'theme', 'captureDelay', 'useActiveTabCapture', 'sidebarHidden', 'listColumns', 'trashExternal'],
            );
            if (cancelled) return;
            setUseIncognito(!!result.useIncognito);
            if (result.theme === 'light' || result.theme === 'dark' || result.theme === 'system') setTheme(result.theme);
            if (result.captureDelay) setCaptureDelay(Number(result.captureDelay));
            setUseActiveTabCapture(!!result.useActiveTabCapture);
            setSidebarHidden(result.sidebarHidden === true);
            setListColumns(sanitizeListColumns(result.listColumns) ?? DEFAULT_LIST_COLUMNS);
            setTrashExternal(result.trashExternal !== false);
        };
        load().catch(err => console.error('[Settings] load failed', err));
        return () => { cancelled = true; };
    }, [loadSeq]);

    const reloadSettings = () => setLoadSeq(n => n + 1);

    const handleSetSidebarHidden = (value: boolean) => {
        setSidebarHidden(value);
        chrome.storage.sync.set({ sidebarHidden: value });
    };

    const handleSetListColumns = (cols: ListColumn[]) => {
        setListColumns(cols);
        chrome.storage.sync.set({ listColumns: cols });
    };

    /** Resolves false when the setting could not be saved (the switch moves back). */
    const handleSetTrashExternal = async (value: boolean): Promise<boolean> => {
        setTrashExternal(value);
        try {
            await chrome.storage.sync.set({ trashExternal: value });
            return true;
        } catch {
            setTrashExternal(!value);
            return false;
        }
    };

    const handleToggleIncognito = (value: boolean) => {
        if (value) {
            chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
                if (!isAllowed) {
                    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
                    alert(
                        "Please enable 'Allow in Incognito' for this extension to capture private screenshots.\n\n" +
                        "Note: Chrome prevents us from highlighting the specific setting, but it's usually near the bottom."
                    );
                } else {
                    setUseIncognito(value);
                    chrome.storage.sync.set({ useIncognito: value });
                    chrome.windows.create({
                        url: chrome.runtime.getURL('index.html'),
                        incognito: true,
                        state: 'maximized',
                    });
                }
            });
        } else {
            setUseIncognito(value);
            chrome.storage.sync.set({ useIncognito: value });
        }
    };

    const handleToggleTheme = () => {
        const modes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
        const newTheme = modes[(modes.indexOf(theme) + 1) % modes.length];
        setTheme(newTheme);
        chrome.storage.sync.set({ theme: newTheme });
    };

    const handleSetTheme = (newTheme: 'light' | 'dark' | 'system') => {
        setTheme(newTheme);
        chrome.storage.sync.set({ theme: newTheme });
    };

    const onCaptureDelayCommit = (value: number) => {
        chrome.storage.sync.set({ captureDelay: value });
    };

    const onToggleActiveTabCapture = (value: boolean) => {
        setUseActiveTabCapture(value);
        chrome.storage.sync.set({ useActiveTabCapture: value });
    };

    return {
        useIncognito,
        theme,
        captureDelay,
        setCaptureDelay,
        useActiveTabCapture,
        handleToggleIncognito,
        handleToggleTheme,
        handleSetTheme,
        onCaptureDelayCommit,
        onToggleActiveTabCapture,
        sidebarHidden,
        setSidebarHidden: handleSetSidebarHidden,
        reloadSettings,
        listColumns,
        setListColumns: handleSetListColumns,
        trashExternal,
        setTrashExternal: handleSetTrashExternal,
    };
}
