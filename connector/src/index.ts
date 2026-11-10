// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bookmarks connector Worker (docs/designs/ai-assistant.md, "Online connector").
 *
 * A remote MCP server with OAuth 2.1 for Claude and ChatGPT. It relays tool
 * calls over a WebSocket that the user's browser extension keeps open to its own
 * Durable Object (LinkObject, src/link.ts). The Worker stores no bookmark data
 * and no long-lived tokens: the access token is the extension's own token, held
 * by the AI app; the Worker keeps it only inside a 2-minute one-time code.
 *
 * Never logged: tokens, secrets, codes, request or response bodies.
 */

import { LINK_ID_RE } from '../../src/lib/bridge/connector.ts';
import { MAX_REQUEST_BYTES, type ClientResponse } from '../../src/lib/bridge/protocol.ts';
import { AuthLimiter, networkOf } from './limiter.ts';
import { LinkObject, OFFLINE_MESSAGE, type CodeRecord } from './link.ts';
import type { McpOutcome } from './mcp.ts';
import {
    CHALLENGE_RE, PAGE_TTL_MS, SCOPE, authServerMetadata, linkFromResource, protectedResourceMetadata, redirectBack,
    registerClient, resourceUrl, signPageState, verifyClientId, verifyPageState, verifyPkce, wwwAuthenticate, type PageState,
} from './oauth.ts';
import { AUTHORIZE_CSS, CSS_PATH, codePage, messagePage } from './page.ts';
import { hmac, randomId, readBody } from './util.ts';

export { LinkObject, AuthLimiter };

/** The slice of a Durable Object namespace the Worker uses (also faked in tests). */
export interface Namespace {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
}

export interface Env {
    /** One LinkObject per link, named by linkId. */
    LINK: Namespace;
    /** One AuthLimiter per network, named by an HMAC of the address. */
    AUTH_LIMITER: Namespace;
    /** Signs client ids and page state, and keys the network HMAC. Secret; the Worker fails closed without it. */
    CLIENT_ID_SECRET: string;
}

const ID = '([A-Za-z0-9_-]{22})';
const MCP_PATH = new RegExp(`^/mcp/${ID}(/authorize|/token|/\\.well-known/(?:oauth-authorization-server|openid-configuration|oauth-protected-resource))?/?$`);
const WELL_KNOWN = new RegExp(`^/\\.well-known/(oauth-protected-resource|oauth-authorization-server|openid-configuration)(?:/mcp/${ID})?/?$`);

const CORS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function pageHeaders(formTarget?: string): Record<string, string> {
    let extra = '';
    if (formTarget) {
        try {
            extra = ` ${new URL(formTarget).origin}`;
        } catch {
            /* none */
        }
    }
    return {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'self'; form-action 'self'${extra}; frame-ancestors 'none'; base-uri 'none'`,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        ...noStore,
    };
}

const html = (body: string, status = 200, formTarget?: string) => new Response(body, { status, headers: pageHeaders(formTarget) });

async function callLink<T>(env: Env, linkId: string, path: string, body: unknown): Promise<T> {
    const stub = env.LINK.get(env.LINK.idFromName(linkId));
    const res = await stub.fetch(`https://link${path}`, {
        method: 'POST',
        headers: { 'X-Link-Id': linkId, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, ...((await res.json()) as object) } as T;
}

/** 4 authorization attempts a minute per network. The address is only ever an HMAC input. */
async function takeAuthSlot(request: Request, env: Env): Promise<{ ok: boolean; retryAfter?: number }> {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const who = await hmac(env.CLIENT_ID_SECRET, 'network', networkOf(ip));
    const stub = env.AUTH_LIMITER.get(env.AUTH_LIMITER.idFromName(who));
    const res = await stub.fetch('https://limiter/take', { method: 'POST' });
    return (await res.json()) as { ok: boolean; retryAfter?: number };
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            return await route(request, env);
        } catch (err) {
            console.error('connector: request failed', new URL(request.url).pathname.replace(/[A-Za-z0-9_-]{22}/g, ':id'), err instanceof Error ? err.name : 'error');
            return json({ error: 'server_error', error_description: 'Something went wrong. Try again.' }, 500);
        }
    },
};

async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname;
    const method = request.method;

    if (path === '/link') return linkSocket(request, env, url);
    if (path === CSS_PATH) return new Response(AUTHORIZE_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    if (path === '/' && method === 'GET') {
        return new Response('Bookmarks connector for Claude and ChatGPT. Copy your connector address from the extension.\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const wk = WELL_KNOWN.exec(path);
    const mcp = MCP_PATH.exec(path);
    const known = wk || mcp || path === '/register' || path === '/authorize' || path === '/token';
    if (!known) return new Response('Not found', { status: 404 });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.CLIENT_ID_SECRET) return json({ error: 'server_error', error_description: 'The connector is not configured.' }, 503, CORS);

    // Metadata documents.
    if (wk || (mcp && mcp[2]?.startsWith('/.well-known/'))) {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { ...CORS, Allow: 'GET, OPTIONS' });
        const kind = wk ? wk[1] : mcp![2].slice('/.well-known/'.length);
        const linkId = wk ? wk[2] : mcp![1];
        const doc = kind === 'oauth-protected-resource' ? protectedResourceMetadata(origin, linkId) : authServerMetadata(origin, linkId);
        return json(doc, 200, { ...CORS, 'Cache-Control': 'public, max-age=3600' });
    }

    if (path === '/register') {
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { ...CORS, Allow: 'POST, OPTIONS' });
        const text = await readBody(request, MAX_REQUEST_BYTES);
        if (text === null) return json({ error: 'invalid_client_metadata', error_description: 'Too large.' }, 413, CORS);
        let meta: unknown;
        try {
            meta = JSON.parse(text);
        } catch {
            return json({ error: 'invalid_client_metadata', error_description: 'Send JSON.' }, 400, CORS);
        }
        const r = await registerClient(env.CLIENT_ID_SECRET, meta, Date.now());
        if (!r.ok) return json({ error: r.error, error_description: r.description }, 400, { ...CORS, ...noStore });
        return json(r.body, 201, { ...CORS, ...noStore });
    }

    const pathLink = mcp ? mcp[1] : null;
    const sub = mcp ? mcp[2] ?? '' : path;
    if (sub === '/authorize') {
        if (method === 'GET') return authorizePage(url, env, pathLink);
        if (method === 'POST') return authorizeAction(request, env, url, pathLink);
        return html(messagePage('Not available', 'Open this page from your AI app.'), 405);
    }
    if (sub === '/token') {
        if (method !== 'POST') return json({ error: 'invalid_request', error_description: 'Use POST.' }, 405, { ...CORS, Allow: 'POST, OPTIONS' });
        return token(request, env, origin, pathLink);
    }
    // /mcp/<linkId>
    if (method === 'POST') return mcpPost(request, env, origin, pathLink!);
    return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST. This server sends JSON responses, not event streams.' } }, 405, { ...CORS, Allow: 'POST, OPTIONS' });
}

// ── Link socket ─────────────────────────────────────────────────────────────

async function linkSocket(request: Request, env: Env, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const linkId = url.searchParams.get('id') ?? '';
    if (!LINK_ID_RE.test(linkId)) return new Response('Bad link id', { status: 400 });
    const stub = env.LINK.get(env.LINK.idFromName(linkId));
    const headers = new Headers(request.headers);
    headers.set('X-Link-Id', linkId);
    return stub.fetch(new Request('https://link/link', { method: 'GET', headers }));
}

// ── Authorize ───────────────────────────────────────────────────────────────

const TRY_AGAIN = 'Go back to the app and add the connector again.';

async function authorizePage(url: URL, env: Env, pathLink: string | null): Promise<Response> {
    const origin = url.origin;
    const q = url.searchParams;
    const resource = q.get('resource');
    const linkId = pathLink ?? linkFromResource(origin, resource);
    if (!linkId) return html(messagePage('This link is not complete', 'In your AI app, add the connector address shown in the extension, then connect again.'), 400);
    if (resource !== null && linkFromResource(origin, resource) !== linkId) return html(messagePage('This link does not match', TRY_AGAIN), 400);

    const clientId = q.get('client_id') ?? '';
    const client = await verifyClientId(env.CLIENT_ID_SECRET, clientId);
    if (!client) return html(messagePage('This app is not registered', TRY_AGAIN), 400);
    const redirectUri = q.get('redirect_uri') ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
    if (!client.redirect_uris.includes(redirectUri)) return html(messagePage('This app address does not match', TRY_AGAIN), 400);

    // From here on, errors go back to the app (RFC 6749 4.1.2.1).
    const issuer = pathLink ? resourceUrl(origin, linkId) : origin;
    const state = q.get('state') ?? undefined;
    // Errors before the user has done anything are shown here, never redirected:
    // registration is open, so an automatic redirect would be an open redirector (RFC 9700 4.11.2).
    const back = (_error: string, description: string) => html(messagePage('This request is not valid', `${description} ${TRY_AGAIN}`), 400);
    if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    const challenge = q.get('code_challenge') ?? '';
    if (q.get('code_challenge_method') !== 'S256' || !CHALLENGE_RE.test(challenge)) return back('invalid_request', 'PKCE with S256 is required.');
    if (state && state.length > 1000) return back('invalid_request', 'state is too long.');

    const page: PageState = {
        linkId, clientId, clientName: client.client_name, redirectUri, state, codeChallenge: challenge,
        scope: q.get('scope') ?? undefined, issuer, pairingId: randomId(16), exp: Date.now() + PAGE_TTL_MS,
    };
    const signed = await signPageState(env.CLIENT_ID_SECRET, page);
    return html(codePage({ clientName: page.clientName, redirectHost: new URL(redirectUri).host, signed, action: url.pathname }), 200, redirectUri);
}

/** Plain words for what the extension answered. */
function pairMessage(res: ClientResponse, finishing: boolean): { error?: string; notice?: string } {
    if (res.ok) return { notice: 'A code now shows in the extension.' };
    const e = res.error;
    switch (e.code) {
        case 'PAIRING_PENDING':
            return finishing ? { error: /tries left/.test(e.message) ? e.message : 'That code is not right. Check the extension and try again.' } : { notice: 'A code now shows in the extension.' };
        case 'NOT_PAIRED':
            return { error: 'That code did not work: it expired, or was typed wrong too many times. Ask the extension for a new code.' };
        case 'NOT_CONNECTED':
            return { error: OFFLINE_MESSAGE };
        case 'RATE_LIMITED': {
            const mins = Math.max(1, Math.ceil((e.retryAfterSeconds ?? 60) / 60));
            return { error: `Too many tries, or another app is connecting right now. Wait ${mins} minute${mins === 1 ? '' : 's'}, then try again.` };
        }
        case 'UPDATE_EXTENSION':
            return { error: 'Update the extension in Chrome, then try again.' };
        default:
            return { error: 'Something went wrong in the extension. Try again.' };
    }
}

async function authorizeAction(request: Request, env: Env, url: URL, pathLink: string | null): Promise<Response> {
    // Only this page may post its forms.
    const from = request.headers.get('Origin');
    const site = request.headers.get('Sec-Fetch-Site');
    if ((from !== null && from !== url.origin) || (site !== null && site !== 'same-origin')) {
        return html(messagePage('Not allowed', 'Open this page from your AI app.'), 403);
    }
    const text = await readBody(request, MAX_REQUEST_BYTES);
    if (text === null) return html(messagePage('Too large', TRY_AGAIN), 413);
    const form = new URLSearchParams(text);
    const page = await verifyPageState(env.CLIENT_ID_SECRET, form.get('p'), Date.now());
    if (page === 'expired') return html(messagePage('This page expired', TRY_AGAIN), 400);
    if (!page || (pathLink !== null && page.linkId !== pathLink)) return html(messagePage('This page is not valid', TRY_AGAIN), 400);

    const show = (o: { error?: string; notice?: string }, status = 200) =>
        html(codePage({ clientName: page.clientName, redirectHost: new URL(page.redirectUri).host, signed: form.get('p')!, action: url.pathname, ...o }), status, page.redirectUri);

    const action = form.get('action');
    if (action !== 'start' && action !== 'finish') return show({ error: 'Something went wrong. Try again.' }, 400);
    let code: string | undefined;
    if (action === 'finish') {
        code = (form.get('code') ?? '').replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) return show({ error: 'Type the 6 digits shown in the extension.' }, 400);
    }
    const slot = await takeAuthSlot(request, env);
    if (!slot.ok) return show({ error: `Too many tries from your network. Wait ${slot.retryAfter ?? 60} seconds, then try again.` }, 429);

    const res = await callLink<ClientResponse>(env, page.linkId, '/pair', { pairingId: page.pairingId, client: page.clientName, ...(code ? { code } : {}) });
    if (action === 'finish' && res.ok && typeof res.body.token === 'string') {
        const put = await callLink<{ code: string }>(env, page.linkId, '/code/put', {
            token: res.body.token, clientId: page.clientId, redirectUri: page.redirectUri, codeChallenge: page.codeChallenge,
        } satisfies Omit<CodeRecord, 'exp'>);
        const location = redirectBack(page.redirectUri, { code: put.code, state: page.state, iss: page.issuer });
        return new Response(null, { status: 303, headers: { Location: location, ...pageHeaders(page.redirectUri) } });
    }
    const msg = pairMessage(res, action === 'finish');
    return show(msg, msg.error ? 400 : 200);
}

// ── Token ───────────────────────────────────────────────────────────────────

async function token(request: Request, env: Env, origin: string, pathLink: string | null): Promise<Response> {
    const fail = (error: string, description: string, status = 400) => json({ error, error_description: description }, status, { ...CORS, ...noStore });
    const text = await readBody(request, MAX_REQUEST_BYTES);
    if (text === null) return fail('invalid_request', 'Too large.', 413);
    let p: URLSearchParams;
    if ((request.headers.get('Content-Type') ?? '').includes('application/json')) {
        try {
            const o = JSON.parse(text) as Record<string, unknown>;
            p = new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === 'string') as [string, string][]);
        } catch {
            return fail('invalid_request', 'Bad JSON.');
        }
    } else p = new URLSearchParams(text);

    const resource = p.get('resource');
    const grant = p.get('grant_type');
    const linkOf = (prefixed: string) => {
        const dot = prefixed.indexOf('.');
        const id = dot > 0 ? prefixed.slice(0, dot) : '';
        return LINK_ID_RE.test(id) ? id : null;
    };
    const issue = (linkId: string, accessToken: string) =>
        json({ access_token: accessToken, token_type: 'Bearer', refresh_token: `${linkId}.${accessToken}`, scope: SCOPE }, 200, { ...CORS, ...noStore });

    if (grant === 'authorization_code') {
        const code = p.get('code') ?? '';
        const linkId = linkOf(code);
        if (!linkId || (pathLink && linkId !== pathLink)) return fail('invalid_grant', 'The code is not valid.');
        if (resource !== null && linkFromResource(origin, resource) !== linkId) return fail('invalid_target', 'The resource does not match.');
        const rec = await callLink<CodeRecord | null>(env, linkId, '/code/take', { code });
        if (!rec || typeof (rec as CodeRecord).token !== 'string') return fail('invalid_grant', 'The code is not valid, was used already, or expired.');
        if (p.get('client_id') !== rec.clientId) return fail('invalid_grant', 'The code was issued to another client.');
        const redirect = p.get('redirect_uri');
        if (redirect !== null && redirect !== rec.redirectUri) return fail('invalid_grant', 'redirect_uri does not match.');
        if (!(await verifyPkce(p.get('code_verifier'), rec.codeChallenge))) return fail('invalid_grant', 'PKCE check failed.');
        return issue(linkId, rec.token);
    }
    if (grant === 'refresh_token') {
        // The extension token does not expire; removing the connection in the extension revokes it.
        const rt = p.get('refresh_token') ?? '';
        const linkId = linkOf(rt);
        const tok = linkId ? rt.slice(linkId.length + 1) : '';
        if (!linkId || (pathLink && linkId !== pathLink) || tok.length < 20 || tok.length > 200 || !/^[A-Za-z0-9_-]+$/.test(tok)) {
            return fail('invalid_grant', 'The refresh token is not valid.');
        }
        if (resource !== null && linkFromResource(origin, resource) !== linkId) return fail('invalid_target', 'The resource does not match.');
        return issue(linkId, tok);
    }
    return fail('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

// ── MCP ─────────────────────────────────────────────────────────────────────

async function mcpPost(request: Request, env: Env, origin: string, linkId: string): Promise<Response> {
    const auth = request.headers.get('Authorization');
    const m = auth ? /^Bearer\s+([A-Za-z0-9_-]{20,200})$/i.exec(auth.trim()) : null;
    if (!m) {
        return json({ error: 'invalid_token', error_description: 'Connect this app to your bookmarks first.' }, 401, {
            ...CORS, 'WWW-Authenticate': wwwAuthenticate(origin, linkId, auth ? 'invalid_token' : undefined),
        });
    }
    const text = await readBody(request, MAX_REQUEST_BYTES);
    if (text === null) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: `Request larger than ${MAX_REQUEST_BYTES / 1024} KB.` } }, 413, CORS);
    const out = await callLink<McpOutcome & { rateLimited?: boolean }>(env, linkId, '/mcp', { token: m[1], text });
    if (out.rateLimited) {
        return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests: at most 60 a minute. Wait a minute, then try again.' } }, 429, { ...CORS, 'Retry-After': '60' });
    }
    if (out.unauthorized) return json(out.body, 401, { ...CORS, 'WWW-Authenticate': wwwAuthenticate(origin, linkId, 'invalid_token') });
    if (out.status === 202) return new Response(null, { status: 202, headers: CORS });
    return json(out.body, out.status, CORS);
}
