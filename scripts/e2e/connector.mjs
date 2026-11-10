// SPDX-License-Identifier: AGPL-3.0-only
//
// Online connector end to end (D20): real headless Chrome with the extension, the
// real Worker under `wrangler dev --local`, and an MCP client that does what
// Claude and ChatGPT do: register, sign in with the code the extension shows,
// exchange the code with PKCE, then call tools that read and change bookmarks.
// Usage: node scripts/e2e/connector.mjs [build dir]   (needs connector/.dev.vars)
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const built = path.resolve(process.argv[2] ?? 'dist');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-conn-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64url = b => Buffer.from(b).toString('base64url');
const check = (n, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' :: ' + JSON.stringify(info).slice(0, 400)}`); if (!ok) process.exitCode = 1; };

// ── Worker ──────────────────────────────────────────────────────────────────
const wport = 8700 + Math.floor(Math.random() * 200);
const worker = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(wport), '--persist-to', path.join(root, 'do'), '--show-interactive-dev-session=false'], {
    cwd: path.resolve('connector'), detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
});
let wout = ''; worker.stdout.on('data', d => (wout += d)); worker.stderr.on('data', d => (wout += d));
const base = `http://127.0.0.1:${wport}`;

// ── Chrome ──────────────────────────────────────────────────────────────────
const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
const cport = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(process.env.CHROME ?? 'google-chrome', ['--headless=new', ...(process.env.E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), `--remote-debugging-port=${cport}`, '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let ws;
try {
    for (let i = 0; i < 120; i++) { await sleep(500); try { if ((await fetch(`${base}/`)).ok) break; } catch { /* starting */ } if (i === 119) throw new Error(`wrangler did not start: ${wout.slice(-800)}`); }
    let v; for (let i = 0; i < 50 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${cport}/json/version`)).json(); } catch { await sleep(200); } }
    ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => (ws.onopen = r));
    let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const ev = async (sid, expr) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, sid); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };

    const ext = (await send('Extensions.loadUnpacked', { path: built })).result.id;
    const t = (await send('Target.createTarget', { url: `chrome-extension://${ext}/index.html`, background: true })).result.targetId;
    const sid = (await send('Target.attachToTarget', { targetId: t, flatten: true })).result.sessionId;
    await sleep(1500);
    const seeded = await ev(sid, `const f = await chrome.bookmarks.create({ parentId: '1', title: 'Recipes' });
        const a = await chrome.bookmarks.create({ parentId: f.id, title: 'Pasta', url: 'https://pasta.example/' });
        const b = await chrome.bookmarks.create({ parentId: f.id, title: 'Soup', url: 'https://soup.example/' });
        await chrome.bookmarks.create({ parentId: '2', title: 'Private', url: 'https://private.example/' });
        // Point the extension at the local Worker (only localhost may replace the production address).
        await chrome.storage.local.set({ connector_link: { enabled: false, origin: '${base}' } });
        const s = await chrome.runtime.sendMessage({ type: 'CONNECTOR_ENABLE' });
        return { f: f.id, a: a.id, b: b.id, address: s.state.address };`);
    let st;
    for (let i = 0; i < 40; i++) { st = await ev(sid, `return (await chrome.runtime.sendMessage({ type: 'CONNECTOR_STATE' })).state;`); if (st.status === 'connected') break; await sleep(250); }
    check('extension links to the Worker', st.status === 'connected', st);
    const mcpUrl = seeded.address;
    check('address is the local Worker', mcpUrl.startsWith(`${base}/mcp/`), mcpUrl);

    // The Connect page shows a standing code; the user ticks only Recipes.
    const code = await ev(sid, `await chrome.runtime.sendMessage({ type: 'BRIDGE_INVITE_OPEN' });
        await chrome.runtime.sendMessage({ type: 'BRIDGE_INVITE_GRANT', folderIds: ['${seeded.f}'], stripQuery: false, mode: 'change' });
        return (await chrome.runtime.sendMessage({ type: 'BRIDGE_STATE' })).state.invite.code;`);
    check('sign-in code shows in the extension', /^\d{6}$/.test(code), code);

    // ── The AI app ──────────────────────────────────────────────────────────
    const unauth = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
    const prmUrl = /resource_metadata="([^"]+)"/.exec(unauth.headers.get('www-authenticate') ?? '')?.[1];
    check('401 points at resource metadata', unauth.status === 401 && !!prmUrl, unauth.status);
    const prm = await (await fetch(prmUrl)).json();
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server${new URL(prm.authorization_servers[0]).pathname}`)).json();
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
    const reg = await (await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }) })).json();
    const verifier = b64url(randomBytes(40));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 's1', resource: mcpUrl });
    const page = await (await fetch(`${as.authorization_endpoint}?${q}`)).text();
    const p = /name="p" value="([^"]+)"/.exec(page)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const fin = await fetch(as.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: new URLSearchParams({ p, action: 'finish', code }) });
    const loc = new URL(fin.headers.get('location') ?? 'http://x/');
    check('sign-in with the code redirects back to the app', fin.status === 303 && loc.searchParams.get('state') === 's1' && !!loc.searchParams.get('code'), fin.status);
    const tok = await (await fetch(as.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), client_id: reg.client_id, redirect_uri: redirectUri, code_verifier: verifier }) })).json();
    check('token exchange with PKCE', typeof tok.access_token === 'string', Object.keys(tok));
    const clients = await ev(sid, `return (await chrome.runtime.sendMessage({ type: 'BRIDGE_STATE' })).state.clients;`);
    check('the extension lists Claude as an online connection', clients.length === 1 && clients[0].name === 'Claude' && clients[0].transport === 'remote', clients);

    let rpc = 0;
    const mcp = async (method, params) => (await (await fetch(mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method, params }) })).json()).result;
    const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude', version: '1' } });
    check('initialize', init?.protocolVersion === '2025-06-18', init);
    const call = (name, args) => mcp('tools/call', { name, arguments: args });
    const lf = await call('list_folders', {});
    check('reads only the folder ticked on the Connect page', lf.structuredContent.folders.length === 1 && lf.structuredContent.folders[0].path === 'Recipes', lf.structuredContent);
    const sr = await call('search', { query: 'private' });
    check('nothing outside it', sr.structuredContent.total === 0, sr.structuredContent);
    const ap = await call('apply_changes', { changeSet: { title: 'Group soups', ops: [{ op: 'create_folder', tempId: 'new:1', parentId: seeded.f, title: 'Soups' }, { op: 'move', id: seeded.b, parentId: 'new:1' }] } });
    const after = await ev(sid, `const [n] = await chrome.bookmarks.get('${seeded.b}'); const [p] = await chrome.bookmarks.get(n.parentId); return p.title;`);
    check('apply_changes changes the bookmarks at once', ap.structuredContent.applied === true && after === 'Soups', { s: ap.structuredContent, after });
    const activity = await ev(sid, `return (await chrome.runtime.sendMessage({ type: 'CS_LIST' }));`);
    check('it shows in AI changes, named after the app', JSON.stringify(activity).includes('Claude'), activity);
    const un = await call('undo_changes', { id: ap.structuredContent.changeSetId });
    const back = await ev(sid, `const [n] = await chrome.bookmarks.get('${seeded.b}'); return n.parentId;`);
    check('undo_changes puts it back', un.structuredContent.undone === true && back === seeded.f, { s: un.structuredContent, back });
    await ev(sid, `await chrome.runtime.sendMessage({ type: 'BRIDGE_REMOVE_ALL' }); return 1;`);
    const gone = await fetch(mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'list_folders', arguments: {} } }) });
    check('removed in the extension: the app must sign in again (401)', gone.status === 401, gone.status);
    await ev(sid, `await chrome.runtime.sendMessage({ type: 'CONNECTOR_DISABLE' }); return 1;`);
    await sleep(800);
    const off = await fetch(mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'list_folders', arguments: {} } }) });
    const offBody = await off.json();
    check('switched off: the app hears the browser is not connected', offBody.result?.structuredContent?.error?.code === 'NOT_CONNECTED', offBody);
} catch (e) { check('run', false, String(e?.stack ?? e)); }
finally {
    try { ws?.close(); } catch { /* */ }
    chrome.kill();
    try { process.kill(-worker.pid, 'SIGINT'); } catch { /* */ }
    for (let i = 0; i < 20 && worker.exitCode === null; i++) await sleep(250);
    try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* */ }
    await sleep(300);
    fs.rmSync(root, { recursive: true, force: true });
}
console.log(process.exitCode ? 'Connector e2e failed' : 'All connector checks passed');
