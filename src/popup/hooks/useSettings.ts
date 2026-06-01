import { useEffect, useState } from 'react';

export function useSettings() {
    const [useIncognito, setUseIncognito] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
    const [captureDelay, setCaptureDelay] = useState<number>(500);
    const [useActiveTabCapture, setUseActiveTabCapture] = useState(false);

    useEffect(() => {
        chrome.storage.sync.get(
            ['useIncognito', 'theme', 'captureDelay', 'useActiveTabCapture'],
            (result) => {
                setUseIncognito(!!result.useIncognito);
                if (result.theme) setTheme(result.theme as 'light' | 'dark' | 'system');
                if (result.captureDelay) setCaptureDelay(Number(result.captureDelay));
                setUseActiveTabCapture(!!result.useActiveTabCapture);
            }
        );
    }, []);

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
    };
}
