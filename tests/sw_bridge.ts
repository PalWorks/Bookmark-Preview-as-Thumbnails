// SPDX-License-Identifier: AGPL-3.0-only
// Connects popup code to a real trash service in-process: chrome.runtime.sendMessage
// goes to handleTrashMessage (as from an extension page), and the service's
// TRASH_CHANGED broadcasts reach chrome.runtime.onMessage listeners.
import { vi } from 'vitest';
import { createTrashService, handleTrashMessage, isTrashMessage } from '../src/sw/trash';
import { createFolderPrefsService, handleFolderPrefsMessage } from '../src/sw/folder_prefs';
import { createChangeSetsService, handleChangeSetMessage, isChangeSetMessage } from '../src/sw/change_sets';
import { createAgentBridge, handleBridgeMessage, isBridgeMessage } from '../src/sw/agent_bridge';
import { findTool, pickArgs } from '../src/lib/bridge/tools';
import { EXTENSION_ORIGIN } from './setup';

type Listener = (message: unknown) => void;

export function connectTrash(opts: { incognito?: boolean; failFirstSend?: boolean } = {}) {
    const listeners = new Set<Listener>();
    const rt = chrome.runtime as unknown as {
        onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
        sendMessage: unknown;
    };
    rt.onMessage.addListener.mockImplementation((fn: Listener) => { listeners.add(fn); });
    rt.onMessage.removeListener.mockImplementation((fn: Listener) => { listeners.delete(fn); });
    const folderPrefs = createFolderPrefsService({ broadcast: (m) => listeners.forEach(l => l(m)) });
    const service = createTrashService({
        broadcast: (m) => listeners.forEach(l => l(m)),
        applyFolderPrefs: (map) => folderPrefs.applySnapshot(map),
    });
    const changeSets = createChangeSetsService({ trash: service, broadcast: (m) => listeners.forEach(l => l(m)) });
    const bridge = createAgentBridge({ changeSets, broadcast: (m) => listeners.forEach(l => l(m)), extVersion: '1.7.0' });
    let failNext = !!opts.failFirstSend;
    const sendMessage = vi.fn(async (msg: unknown) => {
        if (failNext) {
            failNext = false;
            throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        if ((msg as { type?: string })?.type === 'AGENT_TOOL') {
            const m = msg as { name: string; args: Record<string, unknown> };
            const def = findTool(m.name);
            if (!def) return { ok: false, error: 'Unknown tool' };
            return { ok: true, res: await bridge.askAI(def.request, pickArgs(def, m.args)) };
        }
        if (isBridgeMessage(msg)) {
            return handleBridgeMessage(bridge, msg, { url: `${EXTENSION_ORIGIN}index.html` }, !!opts.incognito);
        }
        if (isChangeSetMessage(msg)) {
            return handleChangeSetMessage(changeSets, msg, { url: `${EXTENSION_ORIGIN}index.html` }, !!opts.incognito);
        }
        if (isTrashMessage(msg)) {
            return handleTrashMessage(service, msg, { url: `${EXTENSION_ORIGIN}index.html` }, !!opts.incognito);
        }
        if ((msg as { type?: string })?.type === 'CHECK_AI_AVAILABILITY') return { available: 'unsupported' };
        if ((msg as { type?: string })?.type === 'FOLDER_PREFS_SET') {
            return handleFolderPrefsMessage(folderPrefs, msg as Record<string, unknown>, { url: `${EXTENSION_ORIGIN}index.html` });
        }
        return undefined;
    });
    rt.sendMessage = sendMessage;
    const broadcast = (m: unknown) => listeners.forEach(l => l(m));
    return { service, folderPrefs, changeSets, bridge, sendMessage, listeners, broadcast };
}
