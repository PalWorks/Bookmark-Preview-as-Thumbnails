// SPDX-License-Identifier: AGPL-3.0-only
//
// Page side of the online connector switch (Claude and ChatGPT). The connection
// itself lives in the service worker (src/sw/remote_link.ts).

import { useCallback, useEffect, useState } from 'react';
import type { ConnectorState } from '../../sw/remote_link';

async function send<T>(message: Record<string, unknown>): Promise<T | null> {
    try { return await chrome.runtime.sendMessage(message) as T; } catch { return null; }
}

export interface ConnectorApi {
    state: ConnectorState | null;
    busy: boolean;
    setEnabled: (on: boolean) => Promise<boolean>;
    newAddress: () => Promise<boolean>;
}

export function useConnector(active = true): ConnectorApi {
    const [state, setState] = useState<ConnectorState | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await send<{ ok: boolean; state?: ConnectorState }>({ type: 'CONNECTOR_STATE' });
        if (res?.ok && res.state) setState(res.state);
    }, []);

    useEffect(() => {
        if (!active) return;
        void load();
        const onMessage = (m: unknown) => { if ((m as { type?: string })?.type === 'CONNECTOR_CHANGED') void load(); };
        chrome.runtime.onMessage.addListener(onMessage);
        const timer = setInterval(() => { void load(); }, 5000);
        return () => { chrome.runtime.onMessage.removeListener(onMessage); clearInterval(timer); };
    }, [active, load]);

    const run = async (type: string) => {
        setBusy(true);
        try {
            const res = await send<{ ok: boolean; state?: ConnectorState }>({ type });
            if (res?.ok && res.state) setState(res.state);
            return !!res?.ok;
        } finally { setBusy(false); }
    };

    return {
        state,
        busy,
        setEnabled: (on) => run(on ? 'CONNECTOR_ENABLE' : 'CONNECTOR_DISABLE'),
        newAddress: () => run('CONNECTOR_NEW_ADDRESS'),
    };
}
