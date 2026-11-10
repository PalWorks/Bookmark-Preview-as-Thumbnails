// SPDX-License-Identifier: AGPL-3.0-only
// install, uninstall, doctor on a fake home; the MCP server end to end through the
// real host and a fake extension; error contract and exit codes; token handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { EXIT_CODES, HOST_NAME, STORE_EXTENSION_ID } from '../../src/lib/bridge/protocol.ts';
import { dataDirFromCommandLine } from '../src/detect.ts';

const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
const HOST = new URL('../dist/host.js', import.meta.url).pathname;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function home() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cli-'));
    const env: Record<string, string> = {
        HOME: root, XDG_CONFIG_HOME: path.join(root, '.config'), XDG_DATA_HOME: path.join(root, '.local', 'share'),
        BOOKMARKS_THUMBNAILS_RUNTIME_DIR: path.join(root, 'run'), BOOKMARKS_THUMBNAILS_DATA_DIR: path.join(root, 'data'),
        BOOKMARKS_THUMBNAILS_TOKEN_FILE: path.join(root, 'cfg', 'tokens.json'),
        BOOKMARKS_THUMBNAILS_CHROME_DIRS: '',
    };
    return { root, env };
}

const run = (args: string[], env: Record<string, string>) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

test('install writes the manifest, launcher and host copy; it is idempotent; uninstall removes them', () => {
    const { root, env } = home();
    const r1 = run(['install', '--json', '--extension-id', 'abcdefghijklmnopabcdefghijklmnop'], env);
    assert.equal(r1.status, 0, r1.stderr);
    const manifest = path.join(root, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.deepEqual(m.allowed_origins, [`chrome-extension://${STORE_EXTENSION_ID}/`, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/']);
    assert.ok(m.path.startsWith(env.BOOKMARKS_THUMBNAILS_DATA_DIR), 'launcher is in the stable data folder, not the npx cache');
    const launcher = fs.readFileSync(m.path, 'utf8');
    assert.ok(launcher.includes(`exec '${process.execPath}' '`), launcher);
    assert.ok((fs.statSync(m.path).mode & 0o111) !== 0);
    assert.equal(run(['install', '--json'], env).status, 0, 'second run is fine');
    const dry = run(['install', '--dry-run'], { ...env });
    assert.match(dry.stdout, /would write/);
    const un = run(['uninstall', '--json'], env);
    assert.equal(un.status, 0);
    assert.equal(fs.existsSync(manifest), false);
    fs.rmSync(root, { recursive: true, force: true });
});

test('reads the data folder from a Chrome command line in either form', () => {
    assert.equal(dataDirFromCommandLine('/opt/google/chrome/chrome --remote-debugging-port=9228 --user-data-dir=/home/u/.config/test profile --force-dark-mode https://x'), '/home/u/.config/test profile');
    assert.equal(dataDirFromCommandLine('/opt/google/chrome/chrome\0--user-data-dir=/home/u/p\0about:blank'), '/home/u/p');
    assert.equal(dataDirFromCommandLine('/usr/bin/node --user-data-dir=/home/u/p'), null);
    assert.equal(dataDirFromCommandLine('/opt/google/chrome/chrome --user-data-dir=relative'), null);
    assert.equal(dataDirFromCommandLine('/opt/google/chrome/chrome --no-first-run'), null);
});

test('install finds unpacked copies and Chrome data folders by itself', () => {
    const { root, env } = home();
    const prefs = (dir: string, settings: Record<string, unknown>) => {
        fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'Default', 'Secure Preferences'), JSON.stringify({ extensions: { settings } }));
    };
    const src = path.join(root, 'src-build');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ name: 'Visual Bookmark Manager with Thumbnail Previews' }));
    const other = path.join(root, 'other-ext');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ name: 'Something else' }));
    const unpacked = 'pinepbhghhkcpnjmkohlfnipldbgcogm';
    prefs(path.join(root, '.config', 'google-chrome'), { [unpacked]: { path: src, location: 4 }, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: { path: other, location: 4 } });
    const testProfile = path.join(root, 'test-profile');
    prefs(testProfile, { [STORE_EXTENSION_ID]: { location: 1 } });
    const unrelated = path.join(root, 'unrelated-profile');
    prefs(unrelated, {});
    const e = { ...env, BOOKMARKS_THUMBNAILS_CHROME_DIRS: [testProfile, unrelated].join(path.delimiter) };

    const r = run(['install'], e);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Found an unpacked copy \\(${unpacked}\\)`));
    const main = path.join(root, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    const extra = path.join(testProfile, 'NativeMessagingHosts', `${HOST_NAME}.json`);
    for (const m of [main, extra]) {
        assert.deepEqual(JSON.parse(fs.readFileSync(m, 'utf8')).allowed_origins, [`chrome-extension://${STORE_EXTENSION_ID}/`, `chrome-extension://${unpacked}/`]);
    }
    assert.equal(fs.existsSync(path.join(unrelated, 'NativeMessagingHosts')), false, 'a folder without the extension is left alone');

    const d = JSON.parse(run(['doctor', '--json'], e).stdout) as { checks: Array<{ name: string; ok: boolean }> };
    assert.equal(d.checks.find(c => c.name === `unpacked copy ${unpacked}`)?.ok, true);
    assert.equal(d.checks.find(c => c.name === `chrome (${testProfile}): host manifest`)?.ok, true);

    assert.equal(run(['uninstall'], e).status, 0);
    assert.equal(fs.existsSync(main) || fs.existsSync(extra), false);
    fs.rmSync(root, { recursive: true, force: true });
});

test('review F4: the client refuses a socket folder it does not trust', () => {
    const { root, env } = home();
    fs.mkdirSync(env.BOOKMARKS_THUMBNAILS_RUNTIME_DIR, { mode: 0o777 });
    fs.chmodSync(env.BOOKMARKS_THUMBNAILS_RUNTIME_DIR, 0o777);
    const r = run(['list-folders', '--json'], env);
    assert.equal(r.status, EXIT_CODES.NOT_CONNECTED);
    assert.match(JSON.parse(r.stderr).error.message, /open to other users/);
    fs.rmSync(root, { recursive: true, force: true });
});

test('doctor reports each problem with its fix and exits non-zero', () => {
    const { root, env } = home();
    const r = run(['doctor', '--json'], env);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout) as { ok: boolean; checks: Array<{ name: string; ok: boolean; fix?: string }> };
    const manifest = out.checks.find(c => c.name === 'chrome: host manifest');
    assert.equal(manifest?.ok, false);
    assert.match(manifest?.fix ?? '', /install/);
    fs.rmSync(root, { recursive: true, force: true });
});

test('CLI errors go to stderr as JSON with a fixed exit status per code', () => {
    const { root, env } = home();
    const r = run(['list-folders', '--json'], env);
    assert.equal(r.status, EXIT_CODES.NOT_CONNECTED);
    const e = JSON.parse(r.stderr).error;
    assert.equal(e.code, 'NOT_CONNECTED');
    assert.ok(e.fix && e.docUrl && e.retry);
    const pair = run(['pair', '--json'], env);
    assert.equal(pair.status, EXIT_CODES.NOT_CONNECTED);
    fs.rmSync(root, { recursive: true, force: true });
});

/** Host plus a fake extension that pairs with code 123456 and lists one folder for the paired token. */
function fakeBrowser(env: Record<string, string>) {
    const child = spawn(process.execPath, [HOST, '--browser', 'chrome'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
    const frame = (o: unknown) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };
    let buf = Buffer.alloc(0);
    let ready = false;
    const err = (id: unknown, code: string, message: string) => ({ v: 1, id, ok: false, error: { code, message, fix: 'fix it', retry: 'after_user_action', docUrl: 'https://x/#' } });
    child.stdout!.on('data', (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 4) {
            const n = buf.readUInt32LE(0);
            if (buf.length < 4 + n) break;
            const m = JSON.parse(buf.subarray(4, 4 + n).toString());
            buf = buf.subarray(4 + n);
            if (m.type === 'host_ready') ready = true;
            if (m.type !== 'request') continue;
            const r = m.req as { id: unknown; type: string; token?: string; body?: { code?: string } };
            let res: unknown;
            if (r.type === 'hello') res = { v: 1, id: r.id, ok: true, body: { protocolVersion: 1 } };
            else if (r.type === 'pair') res = r.body?.code === '123456' ? { v: 1, id: r.id, ok: true, body: { token: 'tok-abcdefghijklmnopqrstuvwxyz', clientId: 'c1' } } : err(r.id, 'PAIRING_PENDING', 'code shown');
            else if (r.token !== 'tok-abcdefghijklmnopqrstuvwxyz') res = err(r.id, 'NOT_PAIRED', 'not paired');
            else res = { v: 1, id: r.id, ok: true, body: { folders: [{ id: '5', path: 'Bookmarks bar / Work', count: 3 }] } };
            child.stdin!.write(frame({ type: 'response', conn: m.conn, res }));
        }
    });
    child.stdin!.write(frame({ type: 'init', profileId: 'abcd1234', browser: 'chrome', extVersion: '1.7.0', protocolVersion: 1 }));
    return { child, isReady: () => ready };
}

test('MCP server: initialize, tools with the untrusted-data note, NOT_PAIRED with a fix, pair, then reads', async () => {
    const { root, env } = home();
    const browser = fakeBrowser(env);
    while (!browser.isReady()) await sleep(20);
    const mcp = spawn(process.execPath, [CLI], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const replies = new Map<number, Record<string, unknown>>();
    readline.createInterface({ input: mcp.stdout! }).on('line', l => { const m = JSON.parse(l); replies.set(m.id, m); });
    let id = 0;
    const call = async (method: string, params: Record<string, unknown> = {}) => {
        const my = ++id;
        mcp.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
        while (!replies.has(my)) await sleep(10);
        return replies.get(my)!;
    };
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-agent', version: '1' } });
    assert.equal((init.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
    mcp.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = (await call('tools/list')).result as { tools: Array<{ name: string; description: string }> };
    assert.deepEqual(list.tools.map(t => t.name).sort(), ['apply_changes', 'get_bookmark', 'get_change_set', 'list_folder', 'list_folders', 'pair', 'search', 'undo_changes']);
    for (const t of list.tools.filter(t => ['list_folders', 'list_folder', 'search', 'get_bookmark'].includes(t.name))) assert.match(t.description, /untrusted/);

    const before = (await call('tools/call', { name: 'list_folders', arguments: {} })).result as { isError: boolean; structuredContent: { error: { code: string; fix: string } } };
    assert.equal(before.isError, true);
    assert.equal(before.structuredContent.error.code, 'NOT_PAIRED');

    const start = (await call('tools/call', { name: 'pair', arguments: {} })).result as { isError: boolean; structuredContent: { error: { code: string } } };
    assert.equal(start.structuredContent.error.code, 'PAIRING_PENDING');
    const paired = (await call('tools/call', { name: 'pair', arguments: { code: '123456' } })).result as { isError?: boolean; content: Array<{ text: string }> };
    assert.ok(!paired.isError);
    assert.doesNotMatch(paired.content[0].text, /tok-/, 'the token never goes to the agent');
    const tokenFile = env.BOOKMARKS_THUMBNAILS_TOKEN_FILE;
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);

    const after = (await call('tools/call', { name: 'list_folders', arguments: {} })).result as { structuredContent: { folders: unknown[] } };
    assert.equal(after.structuredContent.folders.length, 1);

    // First run installed the host because none was installed.
    assert.ok(fs.existsSync(path.join(root, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`)));
    mcp.stdin!.end();
    browser.child.kill();
    await sleep(100);
    fs.rmSync(root, { recursive: true, force: true });
});
