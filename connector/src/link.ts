// SPDX-License-Identifier: AGPL-3.0-only
//
// LinkObject: one Durable Object per link (named by linkId). It holds the
// browser's WebSocket (hibernatable API), relays bridge requests over it, keeps
// one-time authorization codes for 2 minutes, and counts MCP requests.
//
// Stored: sha256(link secret), the per-minute MCP counter, and authorization
// codes until used or 2 minutes old (each holds the extension token, the client
// id, redirect URI and PKCE challenge). No bookmark data, no long-lived tokens.
//
// Internal API, reached only through the binding (the Worker passes the link id
// in X-Link-Id):
//   GET  /link        WebSocket upgrade from the browser
//   POST /mcp         {token, text} -> McpOutcome
//   POST /pair        {pairingId, client, code?} -> ClientResponse
//   POST /code/put    {token, clientId, redirectUri, codeChallenge} -> {code}
//   POST /code/take   {code} -> CodeRecord | null (deleted on read)

import { LINK_ID_RE, LINK_REQUEST_TIMEOUT_MS, LINK_SECRET_RE, type LinkFromBrowser, type LinkFromWorker } from '../../src/lib/bridge/connector.ts';
import { PROTOCOL_VERSION, bridgeError, type ClientRequest, type ClientResponse } from '../../src/lib/bridge/protocol.ts';
import { handleMcp } from './mcp.ts';
import { AUTH_CODE_TTL_MS } from './oauth.ts';
import { randomId, safeEqual, sha256 } from './util.ts';

export const MCP_PER_MINUTE = 60;
const MINUTE = 60_000;

export const OFFLINE_MESSAGE =
    "Your browser is not connected. Open Chrome on your computer and make sure the extension's Claude and ChatGPT switch is on.";

export const notConnected = (id: ClientRequest['id'] = 0): ClientResponse => ({
    v: PROTOCOL_VERSION,
    id,
    ok: false,
    error: bridgeError('NOT_CONNECTED', OFFLINE_MESSAGE, { fix: 'Open Chrome on your computer, then try again.' }),
});

/** The pieces of a WebSocket this class uses (the runtime's, or a fake in tests). */
export interface LinkSocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): unknown;
}

export interface LinkStorage {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
}

export interface LinkState {
    storage: LinkStorage;
    acceptWebSocket(ws: LinkSocket): void;
    getWebSockets(): LinkSocket[];
    setWebSocketAutoResponse?(pair: unknown): void;
}

interface Attachment {
    linkId: string;
    authed: boolean;
}

export interface CodeRecord {
    token: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    exp: number;
}

interface Pending {
    resolve: (r: ClientResponse) => void;
    timer: ReturnType<typeof setTimeout>;
    id: ClientRequest['id'];
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

export class LinkObject {
    private state: LinkState;
    private pending = new Map<string, Pending>();
    /**
     * After the browser's socket drops, requests in flight wait this long for it to come back
     * (the extension reconnects after 2 s) and answer on the new socket. Failing them at once
     * told the AI app "not connected" for changes that were in fact applied.
     */
    reconnectGraceMs = 5_000;
    private graceTimer: ReturnType<typeof setTimeout> | null = null;
    now: () => number = () => Date.now();

    constructor(state: LinkState) {
        this.state = state;
        // Pings are answered by the runtime without waking the object.
        const Pair = (globalThis as { WebSocketRequestResponsePair?: new (a: string, b: string) => unknown }).WebSocketRequestResponsePair;
        if (Pair && state.setWebSocketAutoResponse) state.setWebSocketAutoResponse(new Pair('{"type":"ping"}', '{"type":"pong"}'));
    }

    async fetch(request: Request): Promise<Response> {
        const path = new URL(request.url).pathname;
        const linkId = request.headers.get('X-Link-Id') ?? '';
        if (!LINK_ID_RE.test(linkId)) return new Response('bad link', { status: 400 });

        if (path === '/link') {
            if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            this.accept(server as unknown as LinkSocket, linkId);
            return new Response(null, { status: 101, webSocket: client });
        }
        if (request.method !== 'POST') return new Response('not found', { status: 404 });
        let body: Record<string, unknown>;
        try {
            body = (await request.json()) as Record<string, unknown>;
        } catch {
            return new Response('bad request', { status: 400 });
        }
        switch (path) {
            case '/mcp': {
                if (!(await this.takeMcpSlot())) return json({ rateLimited: true, retryAfter: 60 }, 429);
                const out = await handleMcp(String(body.text ?? ''), String(body.token ?? ''), (req, via) => this.relay(req, via));
                return json(out);
            }
            case '/pair': {
                const b: Record<string, unknown> = { pairingId: body.pairingId, client: body.client };
                if (typeof body.code === 'string') b.code = body.code;
                const req: ClientRequest = { v: PROTOCOL_VERSION, id: randomId(9), type: 'pair', body: b };
                return json(await this.relay(req, String(body.client ?? 'AI app')));
            }
            case '/code/put':
                return json({ code: await this.putCode(linkId, body as unknown as Omit<CodeRecord, 'exp'>) });
            case '/code/take':
                return json(await this.takeCode(String(body.code ?? '')));
        }
        return new Response('not found', { status: 404 });
    }

    // ── Socket ──────────────────────────────────────────────────────────────

    /** A new socket waits for its hello; until then it is not the link. */
    accept(ws: LinkSocket, linkId: string): void {
        this.state.acceptWebSocket(ws);
        ws.serializeAttachment({ linkId, authed: false } satisfies Attachment);
    }

    private refuse(ws: LinkSocket, reason: string): void {
        try {
            ws.send(JSON.stringify({ type: 'refused', reason } satisfies LinkFromWorker));
            ws.close(1008, reason);
        } catch {
            /* already gone */
        }
    }

    private liveSocket(): LinkSocket | undefined {
        return this.state.getWebSockets().find((ws) => (ws.deserializeAttachment() as Attachment | null)?.authed);
    }

    async webSocketMessage(ws: LinkSocket, message: string | ArrayBuffer): Promise<void> {
        const att = ws.deserializeAttachment() as Attachment | null;
        let msg: LinkFromBrowser;
        try {
            msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
        } catch {
            if (!att?.authed) this.refuse(ws, 'bad_frame');
            return;
        }
        if (!att) return this.refuse(ws, 'bad_frame');
        if (!att.authed) {
            if (msg?.type !== 'hello') return this.refuse(ws, 'expected_hello');
            return this.hello(ws, att, msg);
        }
        switch (msg?.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' } satisfies LinkFromWorker));
                return;
            case 'response': {
                const p = typeof msg.rid === 'string' ? this.pending.get(msg.rid) : undefined;
                if (!p || !msg.res || typeof msg.res !== 'object') return;
                this.pending.delete(msg.rid);
                clearTimeout(p.timer);
                p.resolve(msg.res);
                return;
            }
        }
    }

    private async hello(ws: LinkSocket, att: Attachment, msg: Extract<LinkFromBrowser, { type: 'hello' }>): Promise<void> {
        if (typeof msg.linkId !== 'string' || !LINK_ID_RE.test(msg.linkId) || msg.linkId !== att.linkId) return this.refuse(ws, 'bad_link_id');
        if (typeof msg.secret !== 'string' || !LINK_SECRET_RE.test(msg.secret)) return this.refuse(ws, 'bad_secret');
        const hash = await sha256(msg.secret);
        const stored = await this.state.storage.get<string>('secretHash');
        if (stored === undefined) await this.state.storage.put('secretHash', hash);
        else if (!safeEqual(stored, hash)) return this.refuse(ws, 'bad_secret');
        // One live socket per link: the newest authenticated one wins.
        for (const other of this.state.getWebSockets()) {
            if (other === ws) continue;
            if ((other.deserializeAttachment() as Attachment | null)?.authed) {
                // Never picked for a relay again, even while the runtime still lists it as closing.
                other.serializeAttachment({ linkId: att.linkId, authed: false } satisfies Attachment);
                try {
                    other.close(4000, 'replaced');
                } catch {
                    /* already gone */
                }
            }
        }
        // Requests still in flight stay pending: the browser answers them on this socket.
        clearTimeout(this.graceTimer);
        ws.serializeAttachment({ linkId: att.linkId, authed: true } satisfies Attachment);
        ws.send(JSON.stringify({ type: 'ready' } satisfies LinkFromWorker));
    }

    async webSocketClose(ws: LinkSocket, code: number): Promise<void> {
        const wasLive = (ws.deserializeAttachment() as Attachment | null)?.authed;
        try {
            ws.close(code === 1005 || code === 1006 ? 1000 : code);
        } catch {
            /* already closed */
        }
        if (wasLive && !this.state.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() as Attachment | null)?.authed)) {
            clearTimeout(this.graceTimer);
            this.graceTimer = setTimeout(() => {
                if (!this.liveSocket()) this.failPending();
            }, this.reconnectGraceMs);
        }
    }

    async webSocketError(ws: LinkSocket): Promise<void> {
        await this.webSocketClose(ws, 1011);
    }

    private failPending(): void {
        for (const [rid, p] of this.pending) {
            clearTimeout(p.timer);
            p.resolve(notConnected(p.id));
            this.pending.delete(rid);
        }
    }

    /**
     * Send one bridge request to the browser and wait for its answer. Pending
     * promises live in memory; the awaiting fetch keeps the object from hibernating.
     */
    relay(req: ClientRequest, via: string): Promise<ClientResponse> {
        const ws = this.liveSocket();
        if (!ws) return Promise.resolve(notConnected(req.id));
        const rid = randomId(12);
        return new Promise<ClientResponse>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(rid);
                resolve({
                    v: PROTOCOL_VERSION, id: req.id, ok: false,
                    error: bridgeError('INTERNAL', 'Your browser did not answer within 30 seconds.', { fix: 'Make sure Chrome is awake on your computer, then try again.', retry: 'after_seconds', retryAfterSeconds: 5 }),
                });
            }, LINK_REQUEST_TIMEOUT_MS);
            this.pending.set(rid, { resolve, timer, id: req.id });
            try {
                ws.send(JSON.stringify({ type: 'request', rid, via, req } satisfies LinkFromWorker));
            } catch {
                clearTimeout(timer);
                this.pending.delete(rid);
                resolve(notConnected(req.id));
            }
        });
    }

    // ── Rate limit and codes ────────────────────────────────────────────────

    /** 60 MCP requests a minute per link (design, "Limits"). */
    async takeMcpSlot(): Promise<boolean> {
        const t = this.now();
        const c = await this.state.storage.get<{ start: number; count: number }>('rl:mcp');
        const cur = c && t - c.start < MINUTE ? c : { start: t, count: 0 };
        if (cur.count >= MCP_PER_MINUTE) return false;
        await this.state.storage.put('rl:mcp', { start: cur.start, count: cur.count + 1 });
        return true;
    }

    /** A one-time code `<linkId>.<random>`, stored under its hash for 2 minutes. */
    async putCode(linkId: string, r: Omit<CodeRecord, 'exp'>): Promise<string> {
        const code = `${linkId}.${randomId(32)}`;
        const exp = this.now() + AUTH_CODE_TTL_MS;
        const record: CodeRecord = { token: r.token, clientId: r.clientId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, exp };
        await this.state.storage.put(`code:${await sha256(code)}`, record);
        const alarm = await this.state.storage.getAlarm();
        if (alarm === null || alarm > exp + 1000) await this.state.storage.setAlarm(exp + 1000);
        return code;
    }

    /** Read and delete: a code works once, and not after 2 minutes. */
    async takeCode(code: string): Promise<CodeRecord | null> {
        if (!code || code.length > 200) return null;
        const key = `code:${await sha256(code)}`;
        const r = await this.state.storage.get<CodeRecord>(key);
        if (!r) return null;
        await this.state.storage.delete(key);
        return r.exp >= this.now() ? r : null;
    }

    /** Delete expired codes and a stale counter; re-arm while codes remain. */
    async alarm(): Promise<void> {
        const t = this.now();
        let next: number | null = null;
        for (const [key, r] of await this.state.storage.list<CodeRecord>({ prefix: 'code:' })) {
            if (r.exp < t) await this.state.storage.delete(key);
            else next = Math.min(next ?? Infinity, r.exp + 1000);
        }
        const c = await this.state.storage.get<{ start: number }>('rl:mcp');
        if (c && t - c.start >= MINUTE) await this.state.storage.delete('rl:mcp');
        if (next !== null) await this.state.storage.setAlarm(next);
    }
}
