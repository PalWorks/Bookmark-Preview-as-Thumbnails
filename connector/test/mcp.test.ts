// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any */
// MCP dispatch (pure) and the Worker end to end over fake Durable Objects:
// registration, the authorize page, token exchange, and MCP with a fake browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFS, AGENT_INSTRUCTIONS } from '../../src/lib/bridge/tools.ts';
import { MAX_REQUEST_BYTES, bridgeError } from '../../src/lib/bridge/protocol.ts';
import { handleMcp, type Relay } from '../src/mcp.ts';
import worker from '../src/index.ts';
import { AUTH_PER_MINUTE } from '../src/limiter.ts';
import { sha256 } from '../src/util.ts';
import { LINK_ID, makeEnv } from './fakes.ts';

const TOKEN = 'tok_' + 'a'.repeat(40);
const rpc = (method: string, params: unknown = {}, id: number | undefined = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const noRelay: Relay = async () => { throw new Error('relay not expected'); };

test('initialize negotiates the protocol and carries the instructions', async () => {
    const a: any = await handleMcp(rpc('initialize', { protocolVersion: '2025-03-26' }), TOKEN, noRelay);
    assert.equal(a.status, 200);
    assert.equal(a.body.result.protocolVersion, '2025-03-26');
    assert.equal(a.body.result.instructions, AGENT_INSTRUCTIONS);
    const b: any = await handleMcp(rpc('initialize', { protocolVersion: '1999-01-01' }), TOKEN, noRelay);
    assert.equal(b.body.result.protocolVersion, '2025-06-18');
});

test('tools/list is TOOL_DEFS exactly, with readOnlyHint and no pair tool', async () => {
    const r: any = await handleMcp(rpc('tools/list'), TOKEN, noRelay);
    assert.deepEqual(r.body.result.tools, TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema, annotations: { readOnlyHint: d.readOnly } })));
    assert.ok(!r.body.result.tools.some((t: any) => t.name === 'pair'));
});

test('tools/call forwards one bridge request with only the tool arguments', async () => {
    let seen: any;
    const relay: Relay = async (req, via) => { seen = { req, via }; return { v: 1, id: req.id, ok: true, body: { folders: [{ id: '1' }] } }; };
    const r: any = await handleMcp(rpc('tools/call', { name: 'list_folder', arguments: { id: '5', limit: 10, extra: 'dropped' } }), TOKEN, relay);
    assert.equal(seen.via, 'AI app');
    assert.equal(seen.req.v, 1);
    assert.equal(seen.req.type, 'list_folder');
    assert.equal(seen.req.token, TOKEN);
    assert.deepEqual(seen.req.body, { id: '5', limit: 10 });
    assert.deepEqual(r.body.result.structuredContent, { folders: [{ id: '1' }] });
    assert.deepEqual(JSON.parse(r.body.result.content[0].text), { folders: [{ id: '1' }] });
});

test('NOT_PAIRED becomes unauthorized; other errors are tool errors', async () => {
    const unpaired: any = await handleMcp(rpc('tools/call', { name: 'search', arguments: { query: 'x' } }), TOKEN, async (req) => ({ v: 1, id: req.id, ok: false, error: bridgeError('NOT_PAIRED', 'no') }));
    assert.equal(unpaired.status, 401);
    assert.equal(unpaired.unauthorized, true);
    const ro: any = await handleMcp(rpc('tools/call', { name: 'apply_changes', arguments: {} }), TOKEN, async (req) => ({ v: 1, id: req.id, ok: false, error: bridgeError('READ_ONLY', 'no') }));
    assert.equal(ro.body.result.isError, true);
    assert.equal(ro.body.result.structuredContent.error.code, 'READ_ONLY');
});

test('JSON-RPC edges: unknown tool, unknown method, notifications, parse errors, batches', async () => {
    assert.equal(((await handleMcp(rpc('tools/call', { name: 'pair' }), TOKEN, noRelay)) as any).body.error.code, -32602);
    assert.equal(((await handleMcp(rpc('resources/list'), TOKEN, noRelay)) as any).body.error.code, -32601);
    assert.equal((await handleMcp(rpc('notifications/initialized', {}, undefined), TOKEN, noRelay)).status, 202);
    const bad: any = await handleMcp('{', TOKEN, noRelay);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, -32700);
    const batch: any = await handleMcp(`[${rpc('ping', {}, 1)},${rpc('ping', {}, 2)}]`, TOKEN, noRelay);
    assert.deepEqual(batch.body.map((m: any) => m.id), [1, 2]);
});

// ── The Worker over fake Durable Objects ────────────────────────────────────

const BASE = 'https://connector.example';
const MCP = `${BASE}/mcp/${LINK_ID}`;
const call = (env: any, path: string, init: RequestInit = {}) => worker.fetch(new Request(path.startsWith('http') ? path : BASE + path, init), env);
const VERIFIER = 'v'.repeat(50);

/** A fake browser that pairs on code 123456 and answers list_folders for its token. */
function fakeExtension() {
    let token: string | null = null;
    const log: any[] = [];
    const answer = (req: any, via: string) => {
        log.push({ req, via });
        if (req.type === 'pair') {
            if (!req.body.code) return { v: 1, id: req.id, ok: false, error: bridgeError('PAIRING_PENDING', 'showing') };
            if (req.body.code !== '123456') return { v: 1, id: req.id, ok: false, error: bridgeError('PAIRING_PENDING', 'That code is not right. 2 tries left.') };
            token = TOKEN;
            return { v: 1, id: req.id, ok: true, body: { token, clientId: 'c1' } };
        }
        if (req.token !== token) return { v: 1, id: req.id, ok: false, error: bridgeError('NOT_PAIRED', 'no') };
        return { v: 1, id: req.id, ok: true, body: { folders: [{ id: '1', path: 'Bookmarks bar', count: 3 }] } };
    };
    return { answer, log };
}

async function register(env: any) {
    const r = await call(env, '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' }) });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
    return ((await r.json()) as any).client_id as string;
}

async function authorizeUrl(clientId: string) {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: await sha256(VERIFIER), code_challenge_method: 'S256', state: 'st8', resource: MCP });
    return `${MCP}/authorize?${q}`;
}

const hiddenP = (page: string) => /name="p" value="([^"]+)"/.exec(page)![1].replace(/&quot;/g, '"');
const post = (env: any, url: string, form: Record<string, string>) =>
    call(env, url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, body: new URLSearchParams(form).toString() });

test('full flow: register, authorize page, code, token, MCP tool call', async () => {
    const { env, browser } = makeEnv();
    const ext = fakeExtension();
    await browser(LINK_ID, ext.answer);
    const clientId = await register(env);

    const page = await call(env, await authorizeUrl(clientId));
    assert.equal(page.status, 200);
    assert.match(page.headers.get('Content-Security-Policy')!, /default-src 'none'.*form-action 'self' https:\/\/claude\.ai/);
    const html = await page.text();
    assert.match(html, /Connect Claude to your bookmarks/);
    assert.match(html, /claude\.ai/);
    assert.match(html, /inputmode="numeric" autocomplete="one-time-code"/);
    assert.match(html, /No code showing\? Ask the extension for one/);
    // A no-referrer policy makes Chrome send Origin: null on the form post, which the origin check refuses.
    assert.doesNotMatch(html, /no-referrer/);
    assert.equal(page.headers.get('Referrer-Policy'), 'same-origin');
    const p = hiddenP(html);

    const started = await post(env, `/mcp/${LINK_ID}/authorize`, { p, action: 'start' });
    assert.match(await started.text(), /A code now shows in the extension/);
    assert.equal(ext.log[0].req.type, 'pair');
    assert.equal(ext.log[0].via, 'Claude');
    assert.equal(ext.log[0].req.body.client, 'Claude');
    assert.equal(ext.log[0].req.body.code, undefined);

    const wrong = await post(env, `/mcp/${LINK_ID}/authorize`, { p, action: 'finish', code: '000000' });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /2 tries left/);

    const done = await post(env, `/mcp/${LINK_ID}/authorize`, { p, action: 'finish', code: '123 456' });
    assert.equal(done.status, 303);
    const loc = new URL(done.headers.get('Location')!);
    assert.equal(loc.origin + loc.pathname, 'https://claude.ai/api/mcp/auth_callback');
    assert.equal(loc.searchParams.get('state'), 'st8');
    assert.equal(loc.searchParams.get('iss'), MCP);
    const code = loc.searchParams.get('code')!;
    assert.equal(ext.log.at(-1).req.body.pairingId, ext.log[0].req.body.pairingId);

    const tokenForm = { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: VERIFIER };
    const badPkce = await call(env, `/mcp/${LINK_ID}/token`, { method: 'POST', body: new URLSearchParams({ ...tokenForm, code_verifier: 'w'.repeat(50) }) });
    assert.equal(badPkce.status, 400); // and the code is now used up
    const used: any = await (await call(env, `/mcp/${LINK_ID}/token`, { method: 'POST', body: new URLSearchParams(tokenForm) })).json();
    assert.equal(used.error, 'invalid_grant');
});

test('token exchange, refresh, and MCP over the Worker', async () => {
    const { env, browser } = makeEnv();
    const ext = fakeExtension();
    await browser(LINK_ID, ext.answer);
    const clientId = await register(env);
    const p = hiddenP(await (await call(env, await authorizeUrl(clientId))).text());
    const done = await post(env, `/mcp/${LINK_ID}/authorize`, { p, action: 'finish', code: '123456' });
    const code = new URL(done.headers.get('Location')!).searchParams.get('code')!;

    // Root /token finds the link from the code prefix.
    const tr = await call(env, '/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: VERIFIER }) });
    assert.equal(tr.status, 200);
    assert.equal(tr.headers.get('Cache-Control'), 'no-store');
    const tok: any = await tr.json();
    assert.equal(tok.access_token, TOKEN);
    assert.equal(tok.token_type, 'Bearer');
    const rf: any = await (await call(env, `/mcp/${LINK_ID}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }) })).json();
    assert.equal(rf.access_token, TOKEN);

    const mcp = (body: string, token = TOKEN) => call(env, MCP, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    const r: any = await (await mcp(rpc('tools/call', { name: 'list_folders', arguments: { limit: 5 } }))).json();
    assert.deepEqual(r.result.structuredContent, { folders: [{ id: '1', path: 'Bookmarks bar', count: 3 }] });
    assert.deepEqual(ext.log.at(-1).req.body, { limit: 5 });

    const stale = await mcp(rpc('tools/call', { name: 'list_folders' }), 'tok_' + 'b'.repeat(40));
    assert.equal(stale.status, 401);
    assert.match(stale.headers.get('WWW-Authenticate')!, /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp\/.*", error="invalid_token"/);
});

test('MCP without a token is 401 pointing at the resource metadata; GET is 405; too large is 413', async () => {
    const { env } = makeEnv();
    const r = await call(env, MCP, { method: 'POST', body: rpc('initialize') });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp/${LINK_ID}"`);
    assert.equal((await call(env, MCP)).status, 405);
    const big = await call(env, MCP, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(MAX_REQUEST_BYTES + 1) });
    assert.equal(big.status, 413);
});

test('a browser that is offline gets a NOT_CONNECTED tool error', async () => {
    const { env } = makeEnv();
    const r: any = await (await call(env, MCP, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: rpc('tools/call', { name: 'search', arguments: { query: 'x' } }) })).json();
    assert.equal(r.result.isError, true);
    assert.equal(r.result.structuredContent.error.code, 'NOT_CONNECTED');
    assert.match(r.result.content[0].text, /Claude and ChatGPT switch/);
});

test('authorize page: offline browser, tampered state, cross-site posts, unknown client', async () => {
    const { env } = makeEnv();
    const clientId = await register(env);
    const p = hiddenP(await (await call(env, await authorizeUrl(clientId))).text());
    const offline = await post(env, `/mcp/${LINK_ID}/authorize`, { p, action: 'start' });
    assert.match(await offline.text(), /Your browser is not connected/);
    const tampered = await post(env, `/mcp/${LINK_ID}/authorize`, { p: p.replace(/^./, (c) => (c === 'e' ? 'f' : 'e')), action: 'start' });
    assert.equal(tampered.status, 400);
    const cross = await call(env, `/mcp/${LINK_ID}/authorize`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `p=${encodeURIComponent(p)}&action=start` });
    assert.equal(cross.status, 403);
    assert.equal((await call(env, `${MCP}/authorize?client_id=nope&redirect_uri=https://claude.ai/api/mcp/auth_callback`)).status, 400);
    // Wrong redirect for a registered client: never redirected there.
    const u = new URL(await authorizeUrl(clientId));
    u.searchParams.set('redirect_uri', 'https://evil.example/cb');
    const wrongRedirect = await call(env, u.toString());
    assert.equal(wrongRedirect.status, 400);
    assert.equal(wrongRedirect.headers.get('Location'), null);
    // No PKCE: shown on the page, never redirected (review D20-4).
    const noPkce = new URL(await authorizeUrl(clientId));
    noPkce.searchParams.delete('code_challenge');
    const back = await call(env, noPkce.toString());
    assert.equal(back.status, 400);
    assert.match(await back.text(), /PKCE/);
});

test('authorization attempts are limited per network', async () => {
    const { env, browser } = makeEnv();
    await browser(LINK_ID, fakeExtension().answer);
    const clientId = await register(env);
    const p = hiddenP(await (await call(env, await authorizeUrl(clientId))).text());
    const attempt = () => call(env, `/mcp/${LINK_ID}/authorize`, { method: 'POST', headers: { Origin: BASE, 'CF-Connecting-IP': '203.0.113.9', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `p=${encodeURIComponent(p)}&action=start` });
    for (let i = 0; i < AUTH_PER_MINUTE; i++) assert.equal((await attempt()).status, 200);
    const limited = await attempt();
    assert.equal(limited.status, 429);
    assert.match(await limited.text(), /Too many tries from your network/);
});

test('metadata, CORS and root fallbacks', async () => {
    const { env } = makeEnv();
    const prm: any = await (await call(env, `/.well-known/oauth-protected-resource/mcp/${LINK_ID}`)).json();
    assert.equal(prm.resource, MCP);
    const as = await call(env, `/.well-known/oauth-authorization-server/mcp/${LINK_ID}`);
    assert.equal(as.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(((await as.json()) as any).issuer, MCP);
    assert.equal(((await (await call(env, '/.well-known/oauth-authorization-server')).json()) as any).authorization_endpoint, `${BASE}/authorize`);
    const opt = await call(env, '/token', { method: 'OPTIONS' });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('Access-Control-Allow-Origin'), '*');
    // Root /authorize takes the link from `resource`.
    const clientId = await register(env);
    const rootUrl = (await authorizeUrl(clientId)).replace(`/mcp/${LINK_ID}/authorize`, '/authorize');
    const rootPage = await call(env, rootUrl);
    assert.equal(rootPage.status, 200);
    // /link is never CORS-enabled and needs an upgrade.
    const link = await call(env, `/link?id=${LINK_ID}`);
    assert.equal(link.status, 426);
    assert.equal(link.headers.get('Access-Control-Allow-Origin'), null);
});

test('fails closed without CLIENT_ID_SECRET', async () => {
    const { env } = makeEnv();
    (env as any).CLIENT_ID_SECRET = '';
    assert.equal((await call(env, '/register', { method: 'POST', body: '{}' })).status, 503);
});

test('review D20-4: a bad authorize request is shown, never redirected (no open redirect)', async () => {
    const { env } = makeEnv();
    const r = await call(env, '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'], client_name: 'X' }) });
    const clientId = ((await r.json()) as any).client_id as string;
    const q = new URLSearchParams({ response_type: 'token', client_id: clientId, redirect_uri: 'https://evil.example/cb', code_challenge: 'x', code_challenge_method: 'plain', resource: MCP });
    const res = await call(env, `${MCP}/authorize?${q}`);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('Location'), null);
});

test('review D20-6: one tools/call per request, so batches cannot multiply the rate limit', async () => {
    let n = 0;
    const relay: Relay = async (req) => { n++; return { v: 1, id: req.id, ok: true, body: {} }; };
    const call1 = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_folders', arguments: {} } });
    const out = await handleMcp(JSON.stringify([call1(1), call1(2)]), 'tok_aaaaaaaaaaaaaaaaaaaaaaaa', relay);
    assert.equal(out.status, 400);
    assert.equal(n, 0);
});
