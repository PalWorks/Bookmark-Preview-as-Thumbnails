// SPDX-License-Identifier: AGPL-3.0-only
// The real host process: framed stdin from a fake extension, real clients on the Unix socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HOST = new URL('../dist/host.js', import.meta.url).pathname;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function frame(obj: unknown): Buffer {
    const b = Buffer.from(JSON.stringify(obj));
    const h = Buffer.alloc(4);
    h.writeUInt32LE(b.length);
    return Buffer.concat([h, b]);
}

/** Start the host with a fake extension that answers every request with its conn and id. */
function startHost(env: Record<string, string>) {
    const child = spawn(process.execPath, [HOST, '--browser', 'chrome'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
    const fromHost: Array<Record<string, unknown>> = [];
    let buf = Buffer.alloc(0);
    child.stdout!.on('data', (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 4) {
            const n = buf.readUInt32LE(0);
            if (buf.length < 4 + n) break;
            const m = JSON.parse(buf.subarray(4, 4 + n).toString());
            buf = buf.subarray(4 + n);
            fromHost.push(m);
            if (m.type === 'request') {
                const req = m.req as { id: number; type: string };
                child.stdin!.write(frame({ type: 'response', conn: m.conn, res: { v: 1, id: req.id, ok: true, body: { conn: m.conn, type: req.type } } }));
            }
        }
    });
    return { child, fromHost };
}

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
    throw new Error('timed out');
}

function client(socket: string) {
    const s = net.connect(socket);
    const lines: Array<Record<string, unknown>> = [];
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', (d: string) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const ready = new Promise(r => s.once('connect', r));
    return { s, lines, ready };
}

function tmp() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-host-'));
    return { root, env: { BOOKMARKS_THUMBNAILS_RUNTIME_DIR: path.join(root, 'run'), BOOKMARKS_THUMBNAILS_DATA_DIR: path.join(root, 'data') } };
}

test('relays per connection: two clients with the same request id get their own answers', async () => {
    const { root, env } = tmp();
    const { child, fromHost } = startHost(env);
    child.stdin!.write(frame({ type: 'init', profileId: 'abcd1234', browser: 'chrome', extVersion: '1.7.0', protocolVersion: 1 }));
    const ready = await waitFor(() => fromHost.find(m => m.type === 'host_ready'));
    const socket = String(ready.socket);
    assert.equal((fs.statSync(socket).mode & 0o777), 0o600);
    assert.equal((fs.statSync(env.BOOKMARKS_THUMBNAILS_RUNTIME_DIR).mode & 0o777), 0o700);

    const a = client(socket); const b = client(socket);
    await a.ready; await b.ready;
    a.s.write(JSON.stringify({ v: 1, id: 7, type: 'hello' }) + '\n');
    b.s.write(JSON.stringify({ v: 1, id: 7, type: 'search' }) + '\n');
    await waitFor(() => a.lines.length && b.lines.length);
    assert.equal((a.lines[0].body as { type: string }).type, 'hello');
    assert.equal((b.lines[0].body as { type: string }).type, 'search');
    assert.notEqual((a.lines[0].body as { conn: number }).conn, (b.lines[0].body as { conn: number }).conn);

    // Closing a client tells the extension.
    a.s.end();
    await waitFor(() => fromHost.find(m => m.type === 'conn_closed'));
    b.s.end();
    child.stdin!.end();
    await new Promise(r => child.once('exit', r));
    assert.equal(fs.existsSync(socket), false, 'socket removed when the browser disconnects');
    fs.rmSync(root, { recursive: true, force: true });
});

test('limits: 4 connections, 64 KB per request, one JSON object per line', async () => {
    const { root, env } = tmp();
    const { child, fromHost } = startHost(env);
    child.stdin!.write(frame({ type: 'init', profileId: 'abcd1234', browser: 'chrome', extVersion: '1.7.0', protocolVersion: 1 }));
    const socket = String((await waitFor(() => fromHost.find(m => m.type === 'host_ready'))).socket);
    const cs = [client(socket), client(socket), client(socket), client(socket)];
    await Promise.all(cs.map(c => c.ready));
    await sleep(100);
    const fifth = client(socket);
    await waitFor(() => fifth.lines[0]);
    assert.equal((fifth.lines[0].error as { code: string }).code, 'RATE_LIMITED');

    cs[0].s.write('not json\n');
    await waitFor(() => cs[0].lines[0]);
    assert.equal((cs[0].lines[0].error as { code: string }).code, 'INVALID_REQUEST');
    cs[1].s.write(JSON.stringify({ v: 1, id: 1, type: 'search', body: { q: 'x'.repeat(70 * 1024) } }) + '\n');
    await waitFor(() => cs[1].lines[0]);
    assert.equal((cs[1].lines[0].error as { code: string }).code, 'TOO_LARGE');
    for (const c of cs) c.s.destroy();
    fifth.s.destroy();
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
});

test('refuses a runtime folder that is a link, and says why on the native port', async () => {
    const { root, env } = tmp();
    const real = path.join(root, 'elsewhere');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, env.BOOKMARKS_THUMBNAILS_RUNTIME_DIR);
    const { child, fromHost } = startHost(env);
    child.stdin!.write(frame({ type: 'init', profileId: 'abcd1234', browser: 'chrome', extVersion: '1.7.0', protocolVersion: 1 }));
    const err = await waitFor(() => fromHost.find(m => m.type === 'host_error'));
    assert.equal(err.code, 'RUNTIME_DIR');
    assert.match(String(err.cause), /not a real folder/);
    await new Promise(r => child.once('exit', r));
    const log = fs.readFileSync(path.join(env.BOOKMARKS_THUMBNAILS_DATA_DIR, 'host.log'), 'utf8');
    assert.match(log, /error RUNTIME_DIR/);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a bad profile id never opens a socket', async () => {
    const { root, env } = tmp();
    const { child, fromHost } = startHost(env);
    child.stdin!.write(frame({ type: 'init', profileId: '../../etc', browser: 'chrome', extVersion: '1', protocolVersion: 1 }));
    const err = await waitFor(() => fromHost.find(m => m.type === 'host_error'));
    assert.equal(err.code, 'BAD_INIT');
    await new Promise<ChildProcess>(r => child.once('exit', () => r(child)));
    fs.rmSync(root, { recursive: true, force: true });
});
