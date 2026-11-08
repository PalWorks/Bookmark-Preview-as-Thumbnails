// SPDX-License-Identifier: AGPL-3.0-only
// Connects popup code to a real trash service in-process: chrome.runtime.sendMessage
// goes to handleTrashMessage (as from an extension page), and the service's
// TRASH_CHANGED broadcasts reach chrome.runtime.onMessage listeners.
import { vi } from 'vitest';
import { createTrashService, handleTrashMessage, isTrashMessage } from '../src/sw/trash';
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
    const service = createTrashService({ broadcast: (m) => listeners.forEach(l => l(m)) });
    let failNext = !!opts.failFirstSend;
    const sendMessage = vi.fn(async (msg: unknown) => {
        if (failNext) {
            failNext = false;
            throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        if (isTrashMessage(msg)) {
            return handleTrashMessage(service, msg, { url: `${EXTENSION_ORIGIN}index.html` }, !!opts.incognito);
        }
        if ((msg as { type?: string })?.type === 'CHECK_AI_AVAILABILITY') return { available: 'unsupported' };
        return undefined;
    });
    rt.sendMessage = sendMessage;
    const broadcast = (m: unknown) => listeners.forEach(l => l(m));
    return { service, sendMessage, listeners, broadcast };
}
