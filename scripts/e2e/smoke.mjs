// SPDX-License-Identifier: AGPL-3.0-only
//
// Real-Chrome smoke test of a built extension (default: dist/). Starts its own
// headless Chrome with a throwaway profile, so it never touches a browser you are
// using. Needs Chrome or Chromium on PATH (CHROME=/path/to/chrome to override).
//
//   npm run build && npm run e2e
//
// Checks: the extension loads; a delete made outside the extension lands in Trash
// and restores with its folder colour; an extension delete is not recorded twice;
// the page has no horizontal scroll at 360 px and 1280 px; no console errors.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
    console.error(`No build at ${dist}. Run npm run build first.`);
    process.exit(2);
}
const chromeBin = process.env.CHROME
    ?? ['google-chrome', 'chromium', 'chromium-browser'].find(b => fs.existsSync(`/usr/bin/${b}`))
    ?? 'google-chrome';
const port = 9300 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-e2e-'));
const chrome = spawn(chromeBin, [
    '--headless=new', `--remote-debugging-port=${port}`, '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, info) => {
    results.push(pass);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass || info === undefined ? '' : ` :: ${JSON.stringify(info).slice(0, 300)}`}`);
};

let ws;
try {
    let version;
    for (let i = 0; i < 50 && !version; i++) {
        try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
    }
    if (!version) throw new Error('Chrome did not start');
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    };
    const send = (method, params = {}, sessionId) => new Promise(r => {
        const i = ++id; pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const ev = async (sid, expr) => {
        const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, sid);
        if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
        return r.result?.result?.value;
    };

    const load = await send('Extensions.loadUnpacked', { path: dist });
    if (!load.result?.id) throw new Error(`Could not load the extension: ${JSON.stringify(load.error)}`);
    const extId = load.result.id;
    await sleep(1500);
    // Foreground target: background tabs throttle timers in headless Chrome.
    const target = (await send('Target.createTarget', { url: 'about:blank' })).result.targetId;
    const sid = (await send('Target.attachToTarget', { targetId: target, flatten: true })).result.sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Page.navigate', { url: `chrome-extension://${extId}/index.html` }, sid);
    await sleep(1500);
    await ev(sid, `await chrome.storage.local.set({ hasSeenWelcome: true }); location.reload(); return 1;`);
    await sleep(1500);

    const v = await ev(sid, `return chrome.runtime.getManifest().version;`);
    check(`extension ${v} loads`, typeof v === 'string');

    const ext = await ev(sid, `
        const f = await chrome.bookmarks.create({ parentId: '1', title: 'E2E folder' });
        await chrome.bookmarks.create({ parentId: f.id, title: 'One', url: 'https://one.example/' });
        await chrome.runtime.sendMessage({ type: 'FOLDER_PREFS_SET', ids: [f.id], patch: { color: 'teal' } });
        await chrome.bookmarks.removeTree(f.id);
        await new Promise(r => setTimeout(r, 4500));
        const L = await chrome.storage.local.get(null);
        const e = Object.values(L).find(x => x && x.version === 1 && x.origin === 'external' && x.title === 'E2E folder');
        if (!e) return { recorded: false };
        const r = await chrome.runtime.sendMessage({ type: 'TRASH_RESTORE', operationId: e.operationId });
        const back = (await chrome.bookmarks.getChildren('1')).find(n => n.title === 'E2E folder');
        const pref = back ? (await chrome.storage.local.get('fpref_' + back.id))['fpref_' + back.id] : undefined;
        return { recorded: true, restored: r.ok && !!back, color: pref?.color };`);
    check('a delete made outside the extension is kept and restores with its colour', ext.recorded && ext.restored && ext.color === 'teal', ext);

    const own = await ev(sid, `
        const b = await chrome.bookmarks.create({ parentId: '1', title: 'E2E own', url: 'https://own.example/' });
        await chrome.runtime.sendMessage({ type: 'TRASH_DELETE', ids: [b.id] });
        await new Promise(r => setTimeout(r, 4000));
        const L = await chrome.storage.local.get(null);
        return Object.values(L).filter(x => x && x.version === 1 && x.title === 'E2E own').map(x => x.origin);`);
    check('an extension delete is recorded once', own.length === 1 && own[0] === 'manual', own);

    for (const [w, mobile] of [[360, true], [1280, false]]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile }, sid);
        await sleep(400);
        const overflow = await ev(sid, `return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
        check(`no horizontal scroll at ${w}px`, overflow <= 0, overflow);
    }
    check('no console errors', errors.length === 0, errors);
} catch (err) {
    check('run', false, String(err));
} finally {
    try { ws?.close(); } catch { /* closing */ }
    chrome.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter(r => !r).length;
console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
