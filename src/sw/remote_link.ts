// SPDX-License-Identifier: AGPL-3.0-only
//
// Online connector, browser side (docs/designs/ai-assistant.md). Keeps one
// WebSocket to this browser's link on the connector Worker and hands every
// request to the agent bridge, which owns pairing, scope and change sets.
// Runs in the regular worker only. No import side effects.
//
// Storage: connector_link {enabled, linkId, secret, origin?}. Never in backups.

import {
    CONNECTOR_ORIGIN, LINK_PING_MS, LINK_IDLE_MS, connectorMcpUrl, connectorSocketUrl,
    type LinkFromBrowser, type LinkFromWorker,
} from '../lib/bridge/connector';
import { PROTOCOL_VERSION, type ClientResponse } from '../lib/bridge/protocol';

export const CONNECTOR_KEY = 'connector_link';
const RETRY_ALARM = 'connector-retry';

interface LinkRecord { enabled: boolean; linkId: string; secret: string; origin?: string }

export interface ConnectorState {
    enabled: boolean;
    status: 'off' | 'connecting' | 'connected' | 'error';
    error?: string;
    /** The address the user pastes into Claude or ChatGPT. */
    address?: string;
}

export interface RemoteLinkDeps {
    /** The bridge's remote entry point. */
    handle: (req: unknown) => Promise<ClientResponse>;
    broadcast?: (m: { type: 'CONNECTOR_CHANGED' }) => void;
    randomBytes?: (n: number) => Uint8Array;
    makeSocket?: (url: string) => WebSocket;
    extVersion?: string;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Only a local development server may replace the production address. */
export function allowedOrigin(o: unknown): string | undefined {
    if (typeof o !== 'string') return undefined;
    return /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(o) ? o : undefined;
}

export function createRemoteLink(deps: RemoteLinkDeps) {
    const randomBytes = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
    const makeSocket = deps.makeSocket ?? ((url: string) => new WebSocket(url));
    const broadcast = deps.broadcast ?? ((m) => { chrome.runtime.sendMessage(m).catch(() => undefined); });
    const extVersion = deps.extVersion ?? chrome.runtime.getManifest?.().version ?? '0';

    let ws: WebSocket | null = null;
    let status: ConnectorState['status'] = 'off';
    let lastError: string | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 2000;
    let lastHeard = 0;

    const changed = () => broadcast({ type: 'CONNECTOR_CHANGED' });

    async function record(): Promise<LinkRecord> {
        const got = (await chrome.storage.local.get(CONNECTOR_KEY))[CONNECTOR_KEY] as Partial<LinkRecord> | undefined;
        if (got && /^[A-Za-z0-9_-]{22}$/.test(got.linkId ?? '') && /^[A-Za-z0-9_-]{43}$/.test(got.secret ?? '')) {
            return { enabled: !!got.enabled, linkId: got.linkId!, secret: got.secret!, ...(allowedOrigin(got.origin) ? { origin: got.origin } : {}) };
        }
        const fresh: LinkRecord = { enabled: !!got?.enabled, linkId: b64url(randomBytes(16)), secret: b64url(randomBytes(32)), ...(allowedOrigin(got?.origin) ? { origin: got!.origin } : {}) };
        await chrome.storage.local.set({ [CONNECTOR_KEY]: fresh });
        return fresh;
    }

    const originOf = (r: LinkRecord) => r.origin ?? CONNECTOR_ORIGIN;

    function send(m: LinkFromBrowser): void {
        try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); } catch { /* closing */ }
    }

    function stopTimers(): void {
        if (pingTimer) clearInterval(pingTimer);
        if (retryTimer) clearTimeout(retryTimer);
        pingTimer = undefined; retryTimer = undefined;
    }

    function scheduleRetry(): void {
        if (retryTimer) return;
        retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, backoff);
        backoff = Math.min(backoff * 2, 60_000);
    }

    // One connect at a time: the worker's start and the retry alarm can both ask at once.
    let connecting: Promise<void> | null = null;
    let wanted = false;
    /** Bumped by every switch-off, so a connect that started before it gives up. */
    let gen = 0;
    function connect(): Promise<void> {
        if (ws) return Promise.resolve();
        if (!connecting) connecting = open().finally(() => { connecting = null; });
        return connecting;
    }

    async function open(): Promise<void> {
        const g = gen;
        const r = await record();
        if (!r.enabled || g !== gen) return;
        wanted = true;
        if (ws) return;
        status = 'connecting';
        changed();
        let sock: WebSocket;
        try {
            sock = makeSocket(`${connectorSocketUrl(originOf(r))}?id=${r.linkId}`);
        } catch (err) {
            status = 'error'; lastError = err instanceof Error ? err.message : String(err); changed();
            scheduleRetry();
            return;
        }
        ws = sock;
        sock.onopen = () => {
            // Switched off while connecting: do not serve requests.
            if (!wanted || ws !== sock) { try { sock.close(); } catch { /* gone */ } return; }
            lastHeard = Date.now();
            send({ type: 'hello', linkId: r.linkId, secret: r.secret, extVersion, protocolVersion: PROTOCOL_VERSION });
            // Traffic every 20 s keeps the socket, and with it this service worker, alive.
            pingTimer = setInterval(() => {
                if (Date.now() - lastHeard > LINK_IDLE_MS) { try { sock.close(); } catch { /* gone */ } return; }
                send({ type: 'ping' });
            }, LINK_PING_MS);
        };
        sock.onmessage = (ev: MessageEvent) => {
            lastHeard = Date.now();
            let m: LinkFromWorker;
            try { m = JSON.parse(String(ev.data)) as LinkFromWorker; } catch { return; }
            switch (m?.type) {
                case 'ready':
                    status = 'connected'; lastError = undefined; backoff = 2000; changed();
                    return;
                case 'refused':
                    status = 'error'; lastError = String(m.reason).slice(0, 200); changed();
                    return;
                case 'ping':
                    send({ type: 'pong' });
                    return;
                case 'request': {
                    const rid = String(m.rid).slice(0, 64);
                    void deps.handle(m.req).then(res => send({ type: 'response', rid, res }));
                    return;
                }
            }
        };
        sock.onclose = () => {
            if (ws !== sock) return;
            ws = null;
            stopTimers();
            if (status !== 'off') {
                if (status !== 'error') { status = 'connecting'; }
                changed();
                scheduleRetry();
            }
        };
        sock.onerror = () => { lastError = lastError ?? 'Could not reach the connector.'; };
    }

    function disconnect(): void {
        gen++;
        wanted = false;
        status = 'off';
        stopTimers();
        const s = ws;
        ws = null;
        try { s?.close(); } catch { /* gone */ }
    }

    async function stateNow(): Promise<ConnectorState> {
        const r = await record();
        return { enabled: r.enabled, status: r.enabled ? status : 'off', error: lastError, address: connectorMcpUrl(originOf(r), r.linkId) };
    }

    async function setEnabled(on: boolean): Promise<ConnectorState> {
        const r = await record();
        await chrome.storage.local.set({ [CONNECTOR_KEY]: { ...r, enabled: on } });
        if (!on) { wanted = false; gen++; }
        if (on) {
            backoff = 2000;
            await connect();
            chrome.alarms?.create(RETRY_ALARM, { periodInMinutes: 1 });
        } else {
            disconnect();
            chrome.alarms?.clear(RETRY_ALARM);
        }
        changed();
        return stateNow();
    }

    /** New address and secret: every app connected through the old address must connect again. */
    async function newAddress(): Promise<ConnectorState> {
        const r = await record();
        disconnect();
        await chrome.storage.local.set({ [CONNECTOR_KEY]: { enabled: r.enabled, linkId: b64url(randomBytes(16)), secret: b64url(randomBytes(32)), ...(r.origin ? { origin: r.origin } : {}) } });
        if (r.enabled) await connect();
        changed();
        return stateNow();
    }

    return {
        start: () => connect(),
        onAlarm: (name: string) => { if (name === RETRY_ALARM && !ws) void connect(); },
        state: stateNow,
        setEnabled,
        newAddress,
    };
}

export type RemoteLink = ReturnType<typeof createRemoteLink>;
