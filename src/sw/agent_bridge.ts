// SPDX-License-Identifier: AGPL-3.0-only
//
// Coding-agent bridge, extension side (docs/designs/agent-bridge.md, Stage 2).
// The extension owns every piece of state: pairing, token hashes, grants, change
// sets. The native host (bridge/ npm package) only relays between a user-only
// socket and this port. Runs in the regular worker only. No import side effects.
//
// Storage: bridge_settings {enabled, profileId}; bridge_clients {[id]: client};
// bridge_idem {[clientId|key]: {setId, hash, at}}. Never in backups.

import {
    PROTOCOL_VERSION, MIN_CLIENT_PROTOCOL, HOST_NAME, MAX_REQUEST_BYTES, READ_LIMIT_DEFAULT, READ_LIMIT_MAX,
    CURSOR_TTL_MS, PAIRING_TTL_MS, PAIRING_MAX_PER_HOUR, PAIRING_MAX_TRIES, MAX_PENDING_PER_CLIENT,
    IDEMPOTENCY_TTL_MS, REQUEST_TYPES, bridgeError, cleanClientName,
    type BridgeError, type ClientRequest, type ClientResponse, type HostToExtension, type ExtensionToHost,
} from '../lib/bridge/protocol';
import { hiddenFolderIds, readFolderPrefs } from '../lib/folder_prefs';
import { listLocalKeys } from '../lib/trash_store';
import { stripQuery } from '../lib/change_set/snapshot';
import type { ChangeSetsService } from './change_sets';

type Node = chrome.bookmarks.BookmarkTreeNode;

export const BRIDGE_SETTINGS_KEY = 'bridge_settings';
export const BRIDGE_CLIENTS_KEY = 'bridge_clients';
export const BRIDGE_IDEM_KEY = 'bridge_idem';
const LAST_USED_EVERY_MS = 10 * 60 * 1000;
const RETRY_ALARM = 'bridge-retry';

export interface BridgeClient {
    id: string;
    name: string;
    tokenHash: string;
    pairedAt: number;
    lastUsedAt?: number;
    /** Folders this agent may read (none at first). */
    folderIds: string[];
    stripQuery: boolean;
    mode: 'read' | 'propose';
}

export interface PairingPrompt {
    /** Random id the client made for this pairing; the code only completes the pairing it started. */
    pairingId: string;
    name: string;
    code: string;
    startedAt: number;
    expiresAt: number;
    tries: number;
    folderIds: string[];
    stripQuery: boolean;
}

export interface BridgeState {
    enabled: boolean;
    status: 'off' | 'connecting' | 'connected' | 'error';
    error?: string;
    hostVersion?: string;
    socket?: string;
    clients: Array<Omit<BridgeClient, 'tokenHash'>>;
    prompt?: Omit<PairingPrompt, 'pairingId' | 'tries'>;
}

export interface AgentBridgeDeps {
    changeSets: ChangeSetsService;
    now?: () => number;
    randomBytes?: (n: number) => Uint8Array;
    connectNative?: (name: string) => chrome.runtime.Port;
    broadcast?: (m: { type: 'BRIDGE_CHANGED' }) => void;
    extVersion?: string;
    browser?: string;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256(s: string): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createAgentBridge(deps: AgentBridgeDeps) {
    const now = deps.now ?? (() => Date.now());
    const randomBytes = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
    const connectNative = deps.connectNative ?? ((name: string) => chrome.runtime.connectNative(name));
    const broadcast = deps.broadcast ?? ((m) => { chrome.runtime.sendMessage(m).catch(() => undefined); });
    const extVersion = deps.extVersion ?? chrome.runtime.getManifest?.().version ?? '0';
    const browser = deps.browser ?? 'chrome';

    let port: chrome.runtime.Port | null = null;
    let status: BridgeState['status'] = 'off';
    let lastError: string | undefined;
    let hostVersion: string | undefined;
    let socket: string | undefined;
    let prompt: PairingPrompt | null = null;
    const promptTimes: number[] = [];
    const blocked = new Map<string, number>();
    const conns = new Map<number, { name?: string; protocol?: number }>();
    // Cursors are invalid after any change, and after a worker restart.
    const bootId = b64url(randomBytes(6));
    let rev = 0;
    const bump = () => { rev++; };

    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
        const run = queue.then(job, job);
        queue = run.catch(() => undefined);
        return run;
    };

    // ── Storage ─────────────────────────────────────────────────────────────

    async function settings(): Promise<{ enabled: boolean; profileId: string }> {
        const got = (await chrome.storage.local.get(BRIDGE_SETTINGS_KEY))[BRIDGE_SETTINGS_KEY] as { enabled?: boolean; profileId?: string } | undefined;
        let profileId = got?.profileId;
        if (!profileId || !/^[a-z0-9]{8}$/.test(profileId)) {
            profileId = [...randomBytes(8)].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
            await chrome.storage.local.set({ [BRIDGE_SETTINGS_KEY]: { enabled: !!got?.enabled, profileId } });
        }
        return { enabled: !!got?.enabled, profileId };
    }

    async function clients(): Promise<Record<string, BridgeClient>> {
        return ((await chrome.storage.local.get(BRIDGE_CLIENTS_KEY))[BRIDGE_CLIENTS_KEY] as Record<string, BridgeClient> | undefined) ?? {};
    }

    async function saveClients(map: Record<string, BridgeClient>): Promise<void> {
        await chrome.storage.local.set({ [BRIDGE_CLIENTS_KEY]: map });
    }

    const changed = () => broadcast({ type: 'BRIDGE_CHANGED' });

    // ── Port ────────────────────────────────────────────────────────────────

    function post(m: ExtensionToHost): void {
        try { port?.postMessage(m); } catch { /* port closed */ }
    }

    async function connect(): Promise<void> {
        if (port) return;
        const s = await settings();
        if (!s.enabled) return;
        status = 'connecting';
        lastError = undefined;
        let p: chrome.runtime.Port;
        try {
            p = connectNative(HOST_NAME);
        } catch (err) {
            status = 'error';
            lastError = err instanceof Error ? err.message : String(err);
            changed();
            return;
        }
        port = p;
        p.onMessage.addListener((m: unknown) => { void enqueue(() => onHost(m as HostToExtension)); });
        p.onDisconnect.addListener(() => {
            const why = chrome.runtime.lastError?.message;
            port = null;
            conns.clear();
            prompt = null;
            if (status !== 'off') {
                status = 'error';
                lastError = why || lastError || 'The helper app stopped.';
            }
            changed();
        });
        post({ type: 'init', profileId: s.profileId, browser, extVersion, protocolVersion: PROTOCOL_VERSION });
        changed();
    }

    function disconnect(): void {
        status = 'off';
        try { port?.disconnect(); } catch { /* already gone */ }
        port = null;
        conns.clear();
        prompt = null;
    }

    async function onHost(m: HostToExtension): Promise<void> {
        switch (m?.type) {
            case 'host_ready':
                status = 'connected';
                hostVersion = String(m.hostVersion).slice(0, 40);
                socket = String(m.socket).slice(0, 300);
                lastError = undefined;
                changed();
                return;
            case 'host_error':
                status = 'error';
                lastError = `${String(m.code).slice(0, 40)}: ${String(m.cause).slice(0, 300)}`;
                changed();
                return;
            case 'conn_open':
                conns.set(m.conn, {});
                return;
            case 'conn_closed':
                conns.delete(m.conn);
                return;
            case 'request': {
                const res = await handleRequest(m.conn, m.req);
                post({ type: 'response', conn: m.conn, res });
                return;
            }
        }
    }

    // ── Requests ────────────────────────────────────────────────────────────

    const fail = (id: ClientRequest['id'], e: BridgeError): ClientResponse => ({ v: PROTOCOL_VERSION, id, ok: false, error: e });
    const ok = (id: ClientRequest['id'], body: Record<string, unknown>): ClientResponse => ({ v: PROTOCOL_VERSION, id, ok: true, body });

    async function handleRequest(conn: number, raw: unknown): Promise<ClientResponse> {
        const req = raw as ClientRequest;
        const id = (typeof req?.id === 'string' || typeof req?.id === 'number') ? req.id : 0;
        try {
            if (JSON.stringify(raw ?? null).length > MAX_REQUEST_BYTES) return fail(id, bridgeError('TOO_LARGE', `Requests are limited to ${MAX_REQUEST_BYTES} bytes.`, { context: { limit: MAX_REQUEST_BYTES } }));
            if (!req || typeof req !== 'object' || !(REQUEST_TYPES as readonly string[]).includes(req.type)) {
                return fail(id, bridgeError('INVALID_REQUEST', 'Unknown request type.'));
            }
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const c = conns.get(conn) ?? {};
            conns.set(conn, c);
            if (req.type === 'hello') {
                const pv = Number(body.protocolVersion);
                c.name = cleanClientName(body.client);
                c.protocol = pv;
                if (!Number.isFinite(pv) || pv < MIN_CLIENT_PROTOCOL) {
                    return fail(id, bridgeError('UPDATE_PACKAGE', `This package speaks protocol ${pv}; the extension needs ${MIN_CLIENT_PROTOCOL} or newer.`, { context: { found: pv, needed: MIN_CLIENT_PROTOCOL } }));
                }
                if (pv > PROTOCOL_VERSION) {
                    return fail(id, bridgeError('UPDATE_EXTENSION', `This package speaks protocol ${pv}; the extension speaks ${PROTOCOL_VERSION}.`, { context: { found: PROTOCOL_VERSION, needed: pv } }));
                }
                return ok(id, { protocolVersion: PROTOCOL_VERSION, minClient: MIN_CLIENT_PROTOCOL, extVersion, hostVersion });
            }
            if (req.type === 'pair') return await pair(id, c.name ?? cleanClientName(body.client), body);

            const client = await authenticate(req.token);
            if (!client) return fail(id, bridgeError('NOT_PAIRED', 'This agent is not paired with this browser profile.'));
            await touch(client);
            switch (req.type) {
                case 'list_folders': return await listFolders(id, client, body);
                case 'list_folder': return await listFolder(id, client, body);
                case 'search': return await search(id, client, body);
                case 'get_bookmark': return await getBookmark(id, client, body);
                case 'propose_changes': return await propose(id, client, body);
                case 'get_change_set': return await getChangeSet(id, client, body);
            }
            return fail(id, bridgeError('INVALID_REQUEST', 'Unknown request type.'));
        } catch (err) {
            const traceId = b64url(randomBytes(6));
            console.error('[Bridge] request failed', traceId, err);
            return fail(id, bridgeError('INTERNAL', 'Something went wrong in the extension.', { traceId }));
        }
    }

    async function authenticate(token: unknown): Promise<BridgeClient | undefined> {
        if (typeof token !== 'string' || token.length < 20 || token.length > 200) return undefined;
        const hash = await sha256(token);
        return Object.values(await clients()).find(c => c.tokenHash === hash);
    }

    async function touch(client: BridgeClient): Promise<void> {
        if (client.lastUsedAt && now() - client.lastUsedAt < LAST_USED_EVERY_MS) return;
        const map = await clients();
        if (!map[client.id]) return;
        map[client.id].lastUsedAt = now();
        await saveClients(map);
    }

    // ── Pairing ─────────────────────────────────────────────────────────────

    async function pair(id: ClientRequest['id'], name: string, body: Record<string, unknown>): Promise<ClientResponse> {
        const t = now();
        if (prompt && prompt.expiresAt <= t) { prompt = null; changed(); }
        const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : undefined;
        const pairingId = typeof body.pairingId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(body.pairingId) ? body.pairingId : undefined;
        if (!pairingId) return fail(id, bridgeError('INVALID_REQUEST', 'pair needs a pairingId (16 to 64 letters, digits, _ or -) that the client keeps for this pairing.'));
        if (!code) {
            if (prompt && prompt.pairingId === pairingId) {
                return fail(id, bridgeError('PAIRING_PENDING', 'A pairing prompt is already showing.', { context: { expiresInSeconds: Math.ceil((prompt.expiresAt - t) / 1000) } }));
            }
            if (prompt) return fail(id, bridgeError('RATE_LIMITED', 'Another agent is pairing right now.', { retryAfterSeconds: Math.ceil((prompt.expiresAt - t) / 1000) }));
            const until = blocked.get(name);
            if (until && until > t) return fail(id, bridgeError('RATE_LIMITED', 'Pairing for this agent name was blocked for an hour.', { retryAfterSeconds: Math.ceil((until - t) / 1000) }));
            while (promptTimes.length && promptTimes[0] < t - 3600_000) promptTimes.shift();
            if (promptTimes.length >= PAIRING_MAX_PER_HOUR) return fail(id, bridgeError('RATE_LIMITED', `At most ${PAIRING_MAX_PER_HOUR} pairing prompts an hour.`, { retryAfterSeconds: Math.ceil((promptTimes[0] + 3600_000 - t) / 1000) }));
            promptTimes.push(t);
            const n = new DataView(randomBytes(4).buffer).getUint32(0) % 1_000_000;
            prompt = { pairingId, name, code: String(n).padStart(6, '0'), startedAt: t, expiresAt: t + PAIRING_TTL_MS, tries: 0, folderIds: [], stripQuery: false };
            changed();
            return fail(id, bridgeError('PAIRING_PENDING', `The extension now shows a 6-digit code for "${name}".`, { context: { expiresInSeconds: PAIRING_TTL_MS / 1000 } }));
        }
        if (!prompt || prompt.pairingId !== pairingId) return fail(id, bridgeError('NOT_PAIRED', 'No pairing prompt is open for this agent. Call pair with no code first.'));
        if (code !== prompt.code) {
            prompt.tries++;
            if (prompt.tries >= PAIRING_MAX_TRIES) { prompt = null; changed(); return fail(id, bridgeError('NOT_PAIRED', 'Wrong code three times; that prompt ended. Call pair with no code to start again.')); }
            changed();
            return fail(id, bridgeError('PAIRING_PENDING', `That code is not right. ${PAIRING_MAX_TRIES - prompt.tries} tries left.`));
        }
        const token = b64url(randomBytes(32));
        const client: BridgeClient = {
            id: b64url(randomBytes(9)), name: prompt.name, tokenHash: await sha256(token), pairedAt: t,
            folderIds: prompt.folderIds, stripQuery: prompt.stripQuery, mode: 'read',
        };
        const map = await clients();
        map[client.id] = client;
        await saveClients(map);
        prompt = null;
        changed();
        return ok(id, { token, clientId: client.id, folders: client.folderIds.length, message: client.folderIds.length ? 'Paired.' : 'Paired. No folders are shared yet: choose them in Settings > Coding agents.' });
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    interface Scope { byId: Map<string, Node>; inScope: (id: string) => boolean; path: (id: string) => string; granted: string[] }

    async function scopeOf(client: BridgeClient): Promise<Scope> {
        const [root] = await chrome.bookmarks.getTree();
        const byId = new Map<string, Node>();
        const walk = (n: Node) => { byId.set(n.id, n); (n.children ?? []).forEach(walk); };
        walk(root);
        const hidden = hiddenFolderIds(await readFolderPrefs());
        const underHidden = (id: string) => {
            let cur = byId.get(id);
            let guard = 0;
            while (cur && guard++ < 512) { if (hidden.has(cur.id)) return true; cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
            return false;
        };
        // Folders hidden from search, and anything inside them, are never shared.
        const granted = client.folderIds.filter(id => byId.has(id) && !byId.get(id)!.url && !underHidden(id));
        const grantedSet = new Set(granted);
        const memo = new Map<string, boolean>();
        const inScope = (id: string): boolean => {
            const known = memo.get(id);
            if (known !== undefined) return known;
            let cur = byId.get(id);
            let result = false;
            let guard = 0;
            // Walking up, a hidden folder met before a granted one keeps it out.
            while (cur && guard++ < 512) {
                if (hidden.has(cur.id)) break;
                if (grantedSet.has(cur.id)) { result = true; break; }
                cur = cur.parentId ? byId.get(cur.parentId) : undefined;
            }
            memo.set(id, result);
            return result;
        };
        // Paths start at the granted folder: names of folders above it are not shared.
        const path = (id: string) => {
            const parts: string[] = [];
            let cur = byId.get(id);
            let guard = 0;
            while (cur && cur.id !== '0' && guard++ < 64) {
                parts.unshift(cur.title);
                if (grantedSet.has(cur.id)) break;
                cur = cur.parentId ? byId.get(cur.parentId) : undefined;
            }
            return parts.join(' / ');
        };
        return { byId, inScope, path, granted };
    }

    async function metaFor(urls: string[]): Promise<Map<string, { tags?: string[]; rating?: number; lastOpenedAt?: number }>> {
        const out = new Map<string, { tags?: string[]; rating?: number; lastOpenedAt?: number }>();
        if (!urls.length) return out;
        const got = await chrome.storage.local.get([...new Set(urls)].map(u => `meta_${u}`));
        for (const [k, v] of Object.entries(got)) {
            const r = v as { tags?: string[]; rating?: number; lastOpenedAt?: number };
            out.set(k.slice(5), { tags: r?.tags, rating: r?.rating, lastOpenedAt: r?.lastOpenedAt });
        }
        return out;
    }

    function limitOf(body: Record<string, unknown>): number {
        const l = Number(body.limit ?? READ_LIMIT_DEFAULT);
        return Number.isInteger(l) && l > 0 ? Math.min(l, READ_LIMIT_MAX) : READ_LIMIT_DEFAULT;
    }

    function encodeCursor(offset: number, key: string): string {
        return b64url(new TextEncoder().encode(JSON.stringify({ o: offset, r: `${bootId}:${rev}`, t: now(), k: key })));
    }

    /** The offset, or a BridgeError when the cursor is stale or for another listing. */
    function decodeCursor(cursor: unknown, key: string): number | BridgeError {
        if (cursor === undefined || cursor === null || cursor === '') return 0;
        try {
            const s = atob(String(cursor).replace(/-/g, '+').replace(/_/g, '/'));
            const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(s, ch => ch.charCodeAt(0)))) as { o: number; r: string; t: number; k: string };
            if (c.k !== key || !Number.isInteger(c.o) || c.o < 0) return bridgeError('INVALID_REQUEST', 'That cursor belongs to another listing.');
            if (c.r !== `${bootId}:${rev}` || now() - c.t > CURSOR_TTL_MS) return bridgeError('CURSOR_EXPIRED', 'Bookmarks changed or the cursor is older than 10 minutes.');
            return c.o;
        } catch {
            return bridgeError('INVALID_REQUEST', 'That cursor is not valid.');
        }
    }

    function page<T>(all: T[], offset: number, limit: number, key: string): { items: T[]; cursor?: string; total: number } {
        const items = all.slice(offset, offset + limit);
        const next = offset + items.length;
        return { items, total: all.length, ...(next < all.length ? { cursor: encodeCursor(next, key) } : {}) };
    }

    const showUrl = (client: BridgeClient, url?: string) => (url && client.stripQuery ? stripQuery(url) : url);

    async function describe(client: BridgeClient, scope: Scope, nodes: Node[]): Promise<Array<Record<string, unknown>>> {
        const meta = await metaFor(nodes.filter(n => n.url).map(n => n.url!));
        const keys = new Set((await listLocalKeys()).filter(k => k.startsWith('thumb_')));
        return nodes.map(n => {
            if (!n.url) return { id: n.id, title: n.title, isFolder: true, path: scope.path(n.id), count: (n.children ?? []).filter(c => scope.inScope(c.id)).length };
            const m = meta.get(n.url);
            return {
                id: n.id, title: n.title, url: showUrl(client, n.url), isFolder: false, folder: scope.path(n.parentId ?? ''),
                ...(m?.tags?.length ? { tags: m.tags } : {}), ...(m?.rating ? { rating: m.rating } : {}),
                ...(m?.lastOpenedAt ? { lastOpenedAt: new Date(m.lastOpenedAt).toISOString() } : {}),
                hasPreview: keys.has(`thumb_${n.url}`),
            };
        });
    }

    async function listFolders(id: ClientRequest['id'], client: BridgeClient, body: Record<string, unknown>): Promise<ClientResponse> {
        const scope = await scopeOf(client);
        const folders: Array<{ id: string; path: string; count: number }> = [];
        const walk = (n: Node) => {
            if (n.url || !scope.inScope(n.id)) return;
            folders.push({ id: n.id, path: scope.path(n.id), count: (n.children ?? []).filter(c => scope.inScope(c.id)).length });
            (n.children ?? []).forEach(walk);
        };
        scope.granted.forEach(id => walk(scope.byId.get(id)!));
        const offset = decodeCursor(body.cursor, 'list_folders');
        if (typeof offset !== 'number') return fail(id, offset);
        const p = page(folders, offset, limitOf(body), 'list_folders');
        return ok(id, { folders: p.items, total: p.total, ...(p.cursor ? { cursor: p.cursor } : {}), ...(scope.granted.length ? {} : { note: 'No folders are shared with this agent yet. The user chooses them in Settings > Coding agents.' }) });
    }

    async function listFolder(id: ClientRequest['id'], client: BridgeClient, body: Record<string, unknown>): Promise<ClientResponse> {
        const scope = await scopeOf(client);
        const fid = String(body.id ?? '');
        const folder = scope.byId.get(fid);
        if (!folder || folder.url || !scope.inScope(fid)) return fail(id, bridgeError('INVALID_REQUEST', 'Unknown folder id, or not shared with this agent.'));
        const offset = decodeCursor(body.cursor, `list_folder:${fid}`);
        if (typeof offset !== 'number') return fail(id, offset);
        const children = (folder.children ?? []).filter(c => scope.inScope(c.id));
        const p = page(children, offset, limitOf(body), `list_folder:${fid}`);
        return ok(id, { folder: { id: fid, path: scope.path(fid) }, items: await describe(client, scope, p.items), total: p.total, ...(p.cursor ? { cursor: p.cursor } : {}) });
    }

    async function search(id: ClientRequest['id'], client: BridgeClient, body: Record<string, unknown>): Promise<ClientResponse> {
        const q = String(body.query ?? '').trim().toLowerCase();
        if (!q || q.length > 200) return fail(id, bridgeError('INVALID_REQUEST', 'query must be 1 to 200 characters.'));
        const scope = await scopeOf(client);
        const offset = decodeCursor(body.cursor, `search:${q}`);
        if (typeof offset !== 'number') return fail(id, offset);
        const marks = [...scope.byId.values()].filter(n => n.url && scope.inScope(n.id));
        const meta = await metaFor(marks.map(n => n.url!));
        const scored: Array<{ n: Node; s: number }> = [];
        for (const n of marks) {
            const title = n.title.toLowerCase();
            // With query stripping on, never match the hidden part (it could be probed letter by letter).
            const url = (showUrl(client, n.url) ?? '').toLowerCase();
            const tags = (meta.get(n.url!)?.tags ?? []).map(t => t.toLowerCase());
            let s = 0;
            if (title.startsWith(q)) s = 4; else if (title.includes(q)) s = 3;
            else if (tags.some(t => t === q)) s = 2.5; else if (tags.some(t => t.includes(q))) s = 2;
            else if (url.includes(q)) s = 1;
            if (s) scored.push({ n, s });
        }
        scored.sort((a, b) => b.s - a.s || a.n.title.localeCompare(b.n.title));
        const p = page(scored.map(x => x.n), offset, limitOf(body), `search:${q}`);
        return ok(id, { items: await describe(client, scope, p.items), total: p.total, ...(p.cursor ? { cursor: p.cursor } : {}) });
    }

    async function getBookmark(id: ClientRequest['id'], client: BridgeClient, body: Record<string, unknown>): Promise<ClientResponse> {
        const scope = await scopeOf(client);
        const bid = String(body.id ?? '');
        const n = scope.byId.get(bid);
        if (!n || !scope.inScope(bid)) return fail(id, bridgeError('INVALID_REQUEST', 'Unknown id, or not shared with this agent.'));
        const [d] = await describe(client, scope, [n]);
        return ok(id, { ...d, ...(n.dateAdded ? { dateAdded: new Date(n.dateAdded).toISOString() } : {}) });
    }

    // ── Proposals ───────────────────────────────────────────────────────────

    async function propose(id: ClientRequest['id'], client: BridgeClient, body: Record<string, unknown>): Promise<ClientResponse> {
        if (client.mode !== 'propose') return fail(id, bridgeError('READ_ONLY', 'This agent may read only.'));
        const raw = body.changeSet;
        if (!raw || (typeof raw !== 'object' && typeof raw !== 'string')) return fail(id, bridgeError('INVALID_REQUEST', 'changeSet is required (an object with an "ops" list).'));
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 100) : undefined;
        const hash = await sha256(text);
        const idemAll = ((await chrome.storage.local.get(BRIDGE_IDEM_KEY))[BRIDGE_IDEM_KEY] as Record<string, { setId: string; hash: string; at: number }> | undefined) ?? {};
        for (const [k, v] of Object.entries(idemAll)) if (v.at + IDEMPOTENCY_TTL_MS < now()) delete idemAll[k];
        if (key) {
            const hit = idemAll[`${client.id}|${key}`];
            if (hit && hit.hash !== hash) return fail(id, bridgeError('INVALID_REQUEST', 'That idempotencyKey was used with a different change set.'));
            if (hit) return ok(id, { accepted: true, changeSetId: hit.setId, repeated: true, message: 'Already received; waiting for the user to review it in the extension.' });
        }
        const scope = await scopeOf(client);
        const res = await deps.changeSets.importText(text, { kind: 'agent', name: client.name }, {
            scopeFolderIds: new Set(scope.granted), clientId: client.id, maxPendingForClient: MAX_PENDING_PER_CLIENT,
        });
        if (!res.ok) {
            const tooMany = /waiting/.test(res.error);
            if (tooMany) return fail(id, bridgeError('RATE_LIMITED', res.error, { retryAfterSeconds: 600 }));
            return ok(id, {
                accepted: false,
                message: res.error,
                results: (res.verdicts ?? []).map(v => ({ change: v.n, ok: v.ok, ...(v.reason ? { reason: v.reason } : {}) })),
            });
        }
        if (key) {
            idemAll[`${client.id}|${key}`] = { setId: res.id, hash, at: now() };
            await chrome.storage.local.set({ [BRIDGE_IDEM_KEY]: idemAll });
        }
        return ok(id, { accepted: true, changeSetId: res.id, message: 'Nothing has changed yet. The user reviews it in the extension (toolbar badge). Poll get_change_set every 10 seconds.' });
    }

    async function getChangeSet(id: ClientRequest['id'], client: BridgeClient, body: Record<string, unknown>): Promise<ClientResponse> {
        const sid = String(body.id ?? '');
        const got = /^[A-Za-z0-9-]{1,64}$/.test(sid) ? await deps.changeSets.get(sid) : { ok: false as const, error: '' };
        if (!got.ok || got.set.clientId !== client.id) return fail(id, bridgeError('INVALID_REQUEST', 'Unknown change set id for this agent.'));
        const { set, items } = got;
        const byN = new Map(items.map(i => [i.n, i]));
        return ok(id, {
            id: set.id, state: set.state, createdAt: new Date(set.createdAt).toISOString(),
            ...(set.decidedAt ? { decidedAt: new Date(set.decidedAt).toISOString() } : {}),
            counts: set.outcome ?? {},
            items: set.ops.map((op, n) => {
                const it = byN.get(n);
                const state = it ? it.state : set.state === 'pending' ? 'pending' : set.approval && !set.approval.selected.includes(n) ? 'not_selected' : set.state;
                return { change: n, op: op.op, state, ...(it?.reason ? { reason: it.reason } : {}) };
            }),
            note: set.state === 'pending' ? 'Waiting for the user. Poll every 10 seconds.' : undefined,
        });
    }

    // ── Page API ────────────────────────────────────────────────────────────

    async function stateNow(): Promise<BridgeState> {
        const s = await settings();
        if (prompt && prompt.expiresAt <= now()) prompt = null;
        const list = Object.values(await clients()).map(({ tokenHash: _t, ...rest }) => rest).sort((a, b) => a.pairedAt - b.pairedAt);
        return {
            enabled: s.enabled, status: s.enabled ? status : 'off', error: lastError, hostVersion, socket, clients: list,
            ...(prompt ? { prompt: { name: prompt.name, code: prompt.code, startedAt: prompt.startedAt, expiresAt: prompt.expiresAt, folderIds: prompt.folderIds, stripQuery: prompt.stripQuery } } : {}),
        };
    }

    async function setEnabled(enabled: boolean): Promise<BridgeState> {
        const s = await settings();
        await chrome.storage.local.set({ [BRIDGE_SETTINGS_KEY]: { enabled, profileId: s.profileId } });
        if (enabled) {
            await connect();
            chrome.alarms?.create(RETRY_ALARM, { periodInMinutes: 1 });
        } else {
            disconnect();
            chrome.alarms?.clear(RETRY_ALARM);
        }
        changed();
        return stateNow();
    }

    async function updateClient(id: string, patch: { folderIds?: unknown; stripQuery?: unknown; mode?: unknown }): Promise<boolean> {
        const map = await clients();
        const c = map[id];
        if (!c) return false;
        if (Array.isArray(patch.folderIds) && patch.folderIds.every(x => typeof x === 'string') && patch.folderIds.length <= 5000) c.folderIds = patch.folderIds as string[];
        if (typeof patch.stripQuery === 'boolean') c.stripQuery = patch.stripQuery;
        if (patch.mode === 'read' || patch.mode === 'propose') c.mode = patch.mode;
        await saveClients(map);
        bump();
        changed();
        return true;
    }

    return {
        /** Worker start, permission granted, or the retry alarm. */
        start: () => enqueue(async () => { await connect(); }),
        onAlarm: (name: string) => { if (name === RETRY_ALARM && !port) void enqueue(() => connect()); },
        /** Bookmarks, folder prefs or metadata changed: cursors become stale. */
        invalidate: bump,
        state: () => enqueue(stateNow),
        setEnabled: (on: boolean) => enqueue(() => setEnabled(on)),
        setPromptGrant: (folderIds: string[], strip: boolean) => enqueue(async () => {
            if (prompt) { prompt.folderIds = folderIds.slice(0, 5000); prompt.stripQuery = strip; changed(); }
            return true;
        }),
        cancelPrompt: (block: boolean) => enqueue(async () => {
            if (prompt && block) blocked.set(prompt.name, now() + 3600_000);
            prompt = null;
            changed();
            return true;
        }),
        updateClient: (id: string, patch: Record<string, unknown>) => enqueue(() => updateClient(id, patch)),
        removeClient: (id: string) => enqueue(async () => {
            const map = await clients();
            delete map[id];
            await saveClients(map);
            changed();
            return true;
        }),
        removeAll: () => enqueue(async () => { await saveClients({}); changed(); return true; }),
        /** Test hook: feed a host message. */
        _host: (m: HostToExtension) => enqueue(() => onHost(m)),
        /** Test hook: handle one request without a port. */
        _request: (conn: number, req: unknown) => enqueue(() => handleRequest(conn, req)),
    };
}

export type AgentBridge = ReturnType<typeof createAgentBridge>;

export const BRIDGE_MESSAGE_TYPES = [
    'BRIDGE_STATE', 'BRIDGE_ENABLE', 'BRIDGE_DISABLE', 'BRIDGE_PROMPT_GRANT', 'BRIDGE_PROMPT_CANCEL',
    'BRIDGE_UPDATE_CLIENT', 'BRIDGE_REMOVE_CLIENT', 'BRIDGE_REMOVE_ALL',
] as const;

export function isBridgeMessage(m: unknown): m is { type: typeof BRIDGE_MESSAGE_TYPES[number] } & Record<string, unknown> {
    return !!m && typeof m === 'object' && (BRIDGE_MESSAGE_TYPES as readonly string[]).includes((m as { type?: string }).type ?? '');
}

export async function handleBridgeMessage(
    bridge: AgentBridge,
    msg: { type: typeof BRIDGE_MESSAGE_TYPES[number] } & Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    incognito: boolean,
): Promise<unknown> {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return { ok: false, error: `${msg.type} rejected: not an extension page` };
    if (incognito) return { ok: false, error: 'Coding agents work in regular windows only.' };
    const ids = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : []);
    switch (msg.type) {
        case 'BRIDGE_STATE': return { ok: true, state: await bridge.state() };
        case 'BRIDGE_ENABLE': return { ok: true, state: await bridge.setEnabled(true) };
        case 'BRIDGE_DISABLE': return { ok: true, state: await bridge.setEnabled(false) };
        case 'BRIDGE_PROMPT_GRANT': return { ok: await bridge.setPromptGrant(ids(msg.folderIds), msg.stripQuery === true) };
        case 'BRIDGE_PROMPT_CANCEL': return { ok: await bridge.cancelPrompt(msg.block === true) };
        case 'BRIDGE_UPDATE_CLIENT': return { ok: typeof msg.id === 'string' && await bridge.updateClient(msg.id, (msg.patch ?? {}) as Record<string, unknown>) };
        case 'BRIDGE_REMOVE_CLIENT': return { ok: typeof msg.id === 'string' && await bridge.removeClient(msg.id) };
        case 'BRIDGE_REMOVE_ALL': return { ok: await bridge.removeAll() };
    }
}
