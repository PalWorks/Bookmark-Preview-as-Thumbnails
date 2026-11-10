// SPDX-License-Identifier: AGPL-3.0-only
//
// Page side of Connect Claude or ChatGPT (local helper and pairing): reads the worker's bridge state and asks
// it to change. The permission itself is requested here, from the click.

import { useCallback, useEffect, useState } from 'react';
import type { BridgeClient, BridgeState } from '../../sw/agent_bridge';

export type ConnectionMode = BridgeClient['mode'];

async function send<T>(message: Record<string, unknown>): Promise<T | null> {
    try { return await chrome.runtime.sendMessage(message) as T; } catch { return null; }
}

export interface BridgeApi {
    state: BridgeState | null;
    busy: boolean;
    /** Must be called from a click: requests the optional permission first. */
    setEnabled: (on: boolean) => Promise<{ ok: boolean; error?: string }>;
    removePermission: () => Promise<void>;
    setPromptGrant: (folderIds: string[], stripQuery: boolean, mode?: ConnectionMode) => Promise<void>;
    /** Standing code for the online connector's sign-in page, while the Connect page is open. */
    openInvite: () => Promise<void>;
    setInviteGrant: (folderIds: string[], stripQuery: boolean, mode: ConnectionMode) => Promise<void>;
    closeInvite: () => Promise<void>;
    cancelPrompt: (block: boolean) => Promise<void>;
    updateClient: (id: string, patch: { folderIds?: string[]; stripQuery?: boolean; mode?: ConnectionMode }) => Promise<void>;
    removeClient: (id: string) => Promise<void>;
    removeAll: () => Promise<void>;
}

export function useBridge(): BridgeApi {
    const [state, setState] = useState<BridgeState | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await send<{ ok: boolean; state?: BridgeState }>({ type: 'BRIDGE_STATE' });
        if (res?.ok && res.state) setState(res.state);
    }, []);

    useEffect(() => {
        void load();
        const onMessage = (m: unknown) => { if ((m as { type?: string })?.type === 'BRIDGE_CHANGED') void load(); };
        chrome.runtime.onMessage.addListener(onMessage);
        // The pairing countdown and "connecting" settle without a broadcast too.
        const timer = setInterval(() => { void load(); }, 5000);
        return () => { chrome.runtime.onMessage.removeListener(onMessage); clearInterval(timer); };
    }, [load]);

    const call = async (message: Record<string, unknown>) => {
        await send(message);
        await load();
    };

    return {
        state,
        busy,
        setEnabled: async (on) => {
            setBusy(true);
            try {
                if (on) {
                    const granted = await chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false);
                    if (!granted) return { ok: false, error: 'Chrome did not grant the permission, so nothing was turned on.' };
                    await call({ type: 'BRIDGE_ENABLE' });
                } else {
                    await call({ type: 'BRIDGE_DISABLE' });
                    await chrome.permissions.remove({ permissions: ['nativeMessaging'] }).catch(() => false);
                }
                return { ok: true };
            } finally { setBusy(false); }
        },
        removePermission: async () => {
            await call({ type: 'BRIDGE_DISABLE' });
            await chrome.permissions.remove({ permissions: ['nativeMessaging'] }).catch(() => false);
            await load();
        },
        setPromptGrant: (folderIds, stripQuery, mode) => call({ type: 'BRIDGE_PROMPT_GRANT', folderIds, stripQuery, mode }),
        openInvite: () => call({ type: 'BRIDGE_INVITE_OPEN' }),
        setInviteGrant: (folderIds, stripQuery, mode) => call({ type: 'BRIDGE_INVITE_GRANT', folderIds, stripQuery, mode }),
        closeInvite: () => call({ type: 'BRIDGE_INVITE_CLOSE' }),
        cancelPrompt: (block) => call({ type: 'BRIDGE_PROMPT_CANCEL', block }),
        updateClient: (id, patch) => call({ type: 'BRIDGE_UPDATE_CLIENT', id, patch }),
        removeClient: (id) => call({ type: 'BRIDGE_REMOVE_CLIENT', id }),
        removeAll: () => call({ type: 'BRIDGE_REMOVE_ALL' }),
    };
}
