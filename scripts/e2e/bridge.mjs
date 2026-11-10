// SPDX-License-Identifier: AGPL-3.0-only
//
// Coding-agent bridge end to end: real headless Chrome (throwaway profile), the
// real native host and the real CLI. Usage: node scripts/e2e/bridge.mjs [dist] [bridge/dist/cli.js]
// Headless Chrome cannot click "Allow" on an optional permission, so this test
// loads a temporary copy of the build where nativeMessaging is a required permission.
import { spawn, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const built = path.resolve(process.argv[2] ?? 'dist');
const cli = path.resolve(process.argv[3] ?? 'bridge/dist/cli.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-e2e-'));
const dist = path.join(root, 'ext');
fs.cpSync(built, dist, { recursive: true });
{ const p = path.join(dist, 'manifest.json'); const m = JSON.parse(fs.readFileSync(p, 'utf8')); m.permissions.push('nativeMessaging'); m.optional_permissions = (m.optional_permissions ?? []).filter(x => x !== 'nativeMessaging'); fs.writeFileSync(p, JSON.stringify(m)); }
const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
const env = { ...process.env, BOOKMARKS_THUMBNAILS_RUNTIME_DIR: path.join(root, 'run'), BOOKMARKS_THUMBNAILS_DATA_DIR: path.join(root, 'data'), BOOKMARKS_THUMBNAILS_TOKEN_FILE: path.join(root, 'tokens.json') };
const port = 9500 + Math.floor(Math.random()*300);
const chromeBin = process.env.CHROME ?? 'google-chrome';
const chrome = spawn(chromeBin, ['--headless=new', ...(process.env.E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), `--remote-debugging-port=${port}`, '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', env });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (n, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' :: ' + JSON.stringify(info).slice(0, 400)}`); if (!ok) process.exitCode = 1; };
let v; for (let i=0;i<50&&!v;i++){ try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200);} }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id=0; const pend=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const send=(method,params={},sessionId)=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}));});
const ev=async(sid,expr)=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${expr}})()`,awaitPromise:true,returnByValue:true},sid); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300)); return r.result?.result?.value;};
const run = (args) => { const r = spawnSync(process.execPath, [cli, ...args, '--json'], { env, encoding: 'utf8' }); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
try {
  const ext=(await send('Extensions.loadUnpacked',{path:dist})).result.id;
  const inst = run(['install', '--extension-id', ext, '--manifest-dir', path.join(profile, 'NativeMessagingHosts')]);
  check('install for this profile', inst.status === 0, inst);
  const t=(await send('Target.createTarget',{url:`chrome-extension://${ext}/index.html`})).result.targetId; const sid=(await send('Target.attachToTarget',{targetId:t,flatten:true})).result.sessionId;
  await sleep(1500);
  const folder = await ev(sid, `const f = await chrome.bookmarks.create({ parentId: '1', title: 'Work' });
    const a = await chrome.bookmarks.create({ parentId: f.id, title: 'Spec doc', url: 'https://spec.example/?session=secret' });
    await chrome.bookmarks.create({ parentId: '1', title: 'Private', url: 'https://private.example/' });
    const s = await chrome.runtime.sendMessage({ type: 'BRIDGE_ENABLE' }); return { f: f.id, a: a.id, s: s.state.status };`);
  await sleep(1500);
  const st = await ev(sid, `return (await chrome.runtime.sendMessage({ type: 'BRIDGE_STATE' })).state;`);
  check('extension connects to the real host', st.status === 'connected', st);
  const doc = run(['doctor']);
  check('doctor sees the connected browser', doc.out?.checks?.find(c => c.name === 'browser connected')?.ok === true, doc.out);
  const nopair = run(['list-folders']);
  check('reads before pairing are refused with NOT_PAIRED', nopair.status === 11 && /NOT_PAIRED/.test(nopair.err), nopair);
  const p1 = run(['pair']);
  const prompt = (await ev(sid, `return (await chrome.runtime.sendMessage({ type: 'BRIDGE_STATE' })).state.prompt;`));
  check('pairing prompt shows in the extension', !!prompt && /^\d{6}$/.test(prompt.code) && p1.status === 12, { p1, prompt });
  await ev(sid, `await chrome.runtime.sendMessage({ type: 'BRIDGE_PROMPT_GRANT', folderIds: ['${folder.f}'], stripQuery: true }); return 1;`);
  const p2 = run(['pair', '--code', prompt.code]);
  check('pair with the code', p2.status === 0 && !JSON.stringify(p2.out).includes('tok'), p2);
  const lf = run(['list-folders']);
  check('only the granted folder is listed', lf.status === 0 && lf.out.folders.length === 1 && lf.out.folders[0].path.endsWith('Work'), lf);
  const sr = run(['search', 'doc']);
  check('search finds it with the query stripped', sr.out?.items?.[0]?.url === 'https://spec.example/', sr);
  const sp = run(['search', 'private']);
  check('nothing outside the grant', sp.out?.items?.length === 0, sp);
  const cs = path.join(root, 'cs.json');
  fs.writeFileSync(cs, JSON.stringify({ title: 'Rename', ops: [{ op: 'rename', id: folder.a, title: 'Spec (final)' }] }));
  const clientId = (await ev(sid, `return (await chrome.runtime.sendMessage({ type: 'BRIDGE_STATE' })).state.clients[0].id;`));
  const csA = path.join(root, 'csa.json');
  fs.writeFileSync(csA, JSON.stringify({ title: 'Rename now', ops: [{ op: 'rename', id: folder.a, title: 'Spec (draft)' }] }));
  const ap = run(['apply', csA]);
  const tA = await ev(sid, `return (await chrome.bookmarks.get('${folder.a}'))[0].title;`);
  check('D20: a new connection changes bookmarks at once', ap.out?.applied === true && tA === 'Spec (draft)', { ap, tA });
  const un = run(['undo', ap.out?.changeSetId ?? 'x']);
  const tU = await ev(sid, `return (await chrome.bookmarks.get('${folder.a}'))[0].title;`);
  check('D20: undo puts it back', un.out?.undone === true && tU === 'Spec doc', { un, tU });
  await ev(sid, `await chrome.runtime.sendMessage({ type: 'BRIDGE_UPDATE_CLIENT', id: '${clientId}', patch: { mode: 'read' } }); return 1;`);
  const ro = run(['propose', cs]);
  check('read-only agent cannot propose', ro.status === 13, ro);
  await ev(sid, `await chrome.runtime.sendMessage({ type: 'BRIDGE_UPDATE_CLIENT', id: '${clientId}', patch: { mode: 'propose' } }); return 1;`);
  const pr = run(['propose', cs, '--key', 'k1']);
  check('proposal accepted, nothing changed yet', pr.out?.accepted === true, pr);
  const title0 = await ev(sid, `return (await chrome.bookmarks.get('${folder.a}'))[0].title;`);
  check('bookmark unchanged until the user applies', title0 === 'Spec doc', title0);
  const badge = await ev(sid, `return await chrome.action.getBadgeText({});`);
  check('toolbar badge shows the waiting proposal', badge === '1', badge);
  await ev(sid, `await chrome.runtime.sendMessage({ type: 'CS_APPLY', id: '${pr.out.changeSetId}', selected: [0] }); return 1;`);
  const g = run(['get-change-set', pr.out.changeSetId]);
  check('agent sees it applied', g.out?.state === 'applied', g);
  const title1 = await ev(sid, `return (await chrome.bookmarks.get('${folder.a}'))[0].title;`);
  check('change applied after approval', title1 === 'Spec (final)', title1);
  await ev(sid, `await chrome.runtime.sendMessage({ type: 'BRIDGE_REMOVE_CLIENT', id: '${clientId}' }); return 1;`);
  const gone = run(['list-folders']);
  check('removed agent is refused and forgets its token', gone.status === 11 && !fs.readFileSync(env.BOOKMARKS_THUMBNAILS_TOKEN_FILE, 'utf8').includes(clientId), gone);
} catch (e) { check('run', false, String(e)); }
finally { ws.close(); chrome.kill(); await sleep(500); fs.rmSync(root, { recursive: true, force: true }); }
console.log(process.exitCode ? 'Bridge e2e failed' : 'All bridge checks passed');
