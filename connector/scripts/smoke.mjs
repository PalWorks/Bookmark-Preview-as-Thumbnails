// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration smoke test against `wrangler dev --local` (workerd, real Durable
// Objects and hibernatable WebSockets). Plays both sides: a fake browser on the
// /link socket, and an MCP client doing registration, the authorize page forms,
// the PKCE token exchange and tool calls.
//
//   node scripts/smoke.mjs               starts wrangler dev on a free port, then stops it
//   SMOKE_URL=http://127.0.0.1:8787 node scripts/smoke.mjs   uses a server you started
//
// Needs CLIENT_ID_SECRET in .dev.vars. Prints only pass/fail lines, never tokens.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = fileURLToPath(new URL('..', import.meta.url));
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let persistDir;
async function start() {
    if (process.env.SMOKE_URL) return process.env.SMOKE_URL.replace(/\/$/, '');
    const port = 8700 + Math.floor(Math.random() * 200);
    // Fresh Durable Object state each run: the per-network limiter (4 a minute)
    // would otherwise count the previous run's attempts from 127.0.0.1.
    persistDir = mkdtempSync(join(tmpdir(), 'connector-smoke-'));
    server = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistDir, '--show-interactive-dev-session=false'], {
        cwd: here, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    });
    let out = '';
    server.stdout.on('data', (d) => (out += d));
    server.stderr.on('data', (d) => (out += d));
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        if (server.exitCode !== null) throw new Error(`wrangler dev exited:\n${out}`);
        try {
            const r = await fetch(`${base}/`);
            if (r.ok) return base;
        } catch { /* not up yet */ }
    }
    throw new Error(`wrangler dev did not start:\n${out}`);
}

let failures = 0;
async function step(name, fn) {
    try {
        await fn();
        console.log(`pass  ${name}`);
    } catch (err) {
        failures++;
        console.log(`FAIL  ${name}\n      ${String(err?.message ?? err).split('\n').slice(0, 6).join('\n      ')}`);
    }
}

/** The fake browser: pairs on 123456, answers list_folders for its own token. */
function fakeBrowser(base, linkId, secret) {
    const token = 'tok_' + b64url(randomBytes(24));
    const seen = [];
    const folders = { folders: [{ id: '1', path: 'Bookmarks bar', count: 3 }, { id: '2', path: 'Other bookmarks', count: 7 }], nextCursor: null };
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/link?id=${linkId}`);
    const frames = [];
    const ready = new Promise((resolve, reject) => {
        ws.addEventListener('error', () => reject(new Error('socket error')));
        ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', linkId, secret, extVersion: '1.7.0', protocolVersion: 1 })));
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(String(ev.data));
            frames.push(msg);
            if (msg.type === 'ready') resolve();
            if (msg.type === 'refused') reject(new Error(`refused: ${msg.reason}`));
            if (msg.type !== 'request') return;
            const { req, via, rid } = msg;
            seen.push({ type: req.type, via, body: req.body, hasToken: req.token === token });
            let res;
            if (req.type === 'pair') {
                if (!req.body.code) res = { v: 1, id: req.id, ok: false, error: { code: 'PAIRING_PENDING', message: 'showing', fix: '', retry: 'after_user_action', docUrl: '' } };
                else if (req.body.code === '123456') res = { v: 1, id: req.id, ok: true, body: { token, clientId: 'c1', folders: 2, message: 'Paired.' } };
                else res = { v: 1, id: req.id, ok: false, error: { code: 'PAIRING_PENDING', message: 'That code is not right. 2 tries left.', fix: '', retry: 'after_user_action', docUrl: '' } };
            } else if (req.token !== token) {
                res = { v: 1, id: req.id, ok: false, error: { code: 'NOT_PAIRED', message: 'not paired', fix: '', retry: 'after_user_action', docUrl: '' } };
            } else if (req.type === 'list_folders') {
                res = { v: 1, id: req.id, ok: true, body: folders };
            } else {
                res = { v: 1, id: req.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'not in smoke', fix: '', retry: 'never', docUrl: '' } };
            }
            ws.send(JSON.stringify({ type: 'response', rid, res }));
        });
    });
    return { ws, ready, seen, frames, token, folders };
}

function openRaw(base, linkId, secret) {
    return new Promise((resolve) => {
        const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/link?id=${linkId}`);
        const got = [];
        ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', linkId, secret, extVersion: '1.7.0', protocolVersion: 1 })));
        ws.addEventListener('message', (ev) => got.push(JSON.parse(String(ev.data))));
        ws.addEventListener('close', (ev) => resolve({ got, code: ev.code }));
        setTimeout(() => { try { ws.close(); } catch { /* */ } resolve({ got, code: 'timeout' }); }, 5000);
    });
}

const hiddenP = (html) => /name="p" value="([^"]+)"/.exec(html)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');

async function main() {
    const base = await start();
    console.log(`smoke against ${base}`);
    const linkId = b64url(randomBytes(16));
    const secret = b64url(randomBytes(32));
    const mcpUrl = `${base}/mcp/${linkId}`;
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
    const verifier = b64url(randomBytes(40));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    let browser, clientId, p, code, accessToken, refreshToken;

    await step('browser link: hello gets ready', async () => {
        browser = fakeBrowser(base, linkId, secret);
        await browser.ready;
    });
    await step('browser link: ping gets pong', async () => {
        browser.ws.send(JSON.stringify({ type: 'ping' }));
        for (let i = 0; i < 20 && !browser.frames.some((f) => f.type === 'pong'); i++) await sleep(100);
        assert.ok(browser.frames.some((f) => f.type === 'pong'));
    });
    await step('browser link: a different secret is refused', async () => {
        const r = await openRaw(base, linkId, b64url(randomBytes(32)));
        assert.equal(r.got[0]?.type, 'refused');
    });
    await step('MCP without a token: 401 with resource_metadata', async () => {
        const r = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
        assert.equal(r.status, 401);
        assert.equal(r.headers.get('www-authenticate'), `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/${linkId}"`);
    });
    await step('metadata documents', async () => {
        const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp/${linkId}`)).json();
        assert.equal(prm.resource, mcpUrl);
        const as = await (await fetch(`${base}/.well-known/oauth-authorization-server/mcp/${linkId}`)).json();
        assert.equal(as.issuer, mcpUrl);
        assert.equal(as.authorization_endpoint, `${mcpUrl}/authorize`);
        assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    });
    await step('dynamic client registration', async () => {
        const r = await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Claude', token_endpoint_auth_method: 'none' }) });
        assert.equal(r.status, 201);
        clientId = (await r.json()).client_id;
        assert.ok(clientId.includes('.'));
    });
    await step('authorize page shows the app and the code field', async () => {
        const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: mcpUrl, scope: 'bookmarks' });
        const r = await fetch(`${mcpUrl}/authorize?${q}`);
        assert.equal(r.status, 200);
        assert.match(r.headers.get('content-security-policy'), /form-action 'self' https:\/\/claude\.ai/);
        const html = await r.text();
        assert.match(html, /Connect Claude to your bookmarks/);
        assert.match(html, /autocomplete="one-time-code"/);
        p = hiddenP(html);
        const css = await fetch(`${base}/assets/authorize.css`);
        assert.equal(css.status, 200);
    });
    const form = (fields) => fetch(`${mcpUrl}/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: new URLSearchParams(fields) });
    await step('"Ask the extension for one" sends pair without a code', async () => {
        const r = await form({ p, action: 'start' });
        assert.equal(r.status, 200);
        assert.match(await r.text(), /A code now shows in the extension/);
        const s = browser.seen.at(-1);
        assert.equal(s.type, 'pair');
        assert.equal(s.via, 'Claude');
        assert.equal(s.body.code, undefined);
    });
    await step('a wrong code says how many tries are left', async () => {
        const r = await form({ p, action: 'finish', code: '000000' });
        assert.equal(r.status, 400);
        assert.match(await r.text(), /2 tries left/);
    });
    await step('the right code redirects back with code, state and iss', async () => {
        const r = await form({ p, action: 'finish', code: '123456' });
        assert.equal(r.status, 303);
        const loc = new URL(r.headers.get('location'));
        assert.equal(`${loc.origin}${loc.pathname}`, redirectUri);
        assert.equal(loc.searchParams.get('state'), 'xyz');
        assert.equal(loc.searchParams.get('iss'), mcpUrl);
        code = loc.searchParams.get('code');
        assert.ok(code.startsWith(`${linkId}.`));
    });
    await step('token exchange with PKCE', async () => {
        const r = await fetch(`${mcpUrl}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: mcpUrl }) });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const t = await r.json();
        assert.equal(t.token_type, 'Bearer');
        assert.equal(t.access_token, browser.token);
        accessToken = t.access_token;
        refreshToken = t.refresh_token;
    });
    await step('the code works only once', async () => {
        const r = await fetch(`${mcpUrl}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier }) });
        assert.equal(r.status, 400);
        assert.equal((await r.json()).error, 'invalid_grant');
    });
    await step('refresh returns the same token', async () => {
        const r = await fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }) });
        assert.equal((await r.json()).access_token, accessToken);
    });
    const mcp = (body, token = accessToken) => fetch(mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    await step('initialize', async () => {
        const r = await (await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })).json();
        assert.equal(r.result.protocolVersion, '2025-06-18');
        assert.match(r.result.instructions, /bookmarks/);
        const n = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
        assert.equal(n.status, 202);
    });
    await step('tools/list', async () => {
        const r = await (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
        const names = r.result.tools.map((t) => t.name);
        assert.ok(names.includes('list_folders') && names.includes('apply_changes') && !names.includes('pair'), names.join(','));
        assert.equal(r.result.tools.find((t) => t.name === 'list_folders').annotations.readOnlyHint, true);
    });
    await step('tools/call list_folders is relayed to the browser and back', async () => {
        const r = await (await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_folders', arguments: { limit: 50, junk: 1 } } })).json();
        assert.deepEqual(r.result.structuredContent, browser.folders);
        const s = browser.seen.at(-1);
        assert.equal(s.type, 'list_folders');
        assert.equal(s.via, 'AI app');
        assert.equal(s.hasToken, true);
        assert.deepEqual(s.body, { limit: 50 });
    });
    await step('a token the extension does not know: 401 so the app re-authorises', async () => {
        const r = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_folders', arguments: {} } }, 'tok_' + b64url(randomBytes(24)));
        assert.equal(r.status, 401);
        assert.match(r.headers.get('www-authenticate'), /error="invalid_token"/);
    });
    await step('after the browser disconnects: NOT_CONNECTED tool error', async () => {
        browser.ws.close();
        await sleep(500);
        const r = await (await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_folders', arguments: {} } })).json();
        assert.equal(r.result.isError, true);
        assert.equal(r.result.structuredContent.error.code, 'NOT_CONNECTED');
    });
    await step('the link reconnects with its own secret', async () => {
        const again = fakeBrowser(base, linkId, secret);
        await again.ready;
        again.ws.close();
    });
}

try {
    await main();
} catch (err) {
    failures++;
    console.log(`FAIL  setup: ${err?.message ?? err}`);
} finally {
    if (server) {
        // npx starts wrangler in a child process: stop the whole group.
        const group = (sig) => { try { process.kill(-server.pid, sig); } catch { /* gone */ } };
        group('SIGINT');
        for (let i = 0; i < 20 && server.exitCode === null; i++) await sleep(250);
        group('SIGKILL');
    }
    if (persistDir) rmSync(persistDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
