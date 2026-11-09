// SPDX-License-Identifier: AGPL-3.0-only
//
// Native messaging host. Chrome starts it when the extension's switch is on. It
// holds no state: it opens a user-only Unix socket and relays JSON lines between
// clients (MCP server, CLI) and the extension's port, tagging each with a
// connection number so replies never cross. Pairing, tokens and every decision
// stay in the extension.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MAX_CONNECTIONS, MAX_REQUEST_BYTES, type ExtensionToHost, type HostToExtension } from '../../src/lib/bridge/protocol.ts';
import { checkRuntimeDir, dataDir, hostLog, runtimeDir, socketPath } from './paths.ts';

declare const __PACKAGE_VERSION__: string;
const VERSION = typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.0.0-dev';

const browserArg = (() => {
    const i = process.argv.indexOf('--browser');
    const b = i > 0 ? process.argv[i + 1] : 'chrome';
    return /^[a-z]{2,12}$/.test(b ?? '') ? b! : 'chrome';
})();

function log(line: string): void {
    try {
        fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
        fs.appendFileSync(hostLog(), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    } catch { /* logging must never stop the host */ }
}

// ── Native port framing (4-byte little-endian length) ──────────────────────────

function send(m: HostToExtension): void {
    const body = Buffer.from(JSON.stringify(m));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([head, body]));
}

let server: net.Server | null = null;
let sockPath: string | null = null;
const conns = new Map<number, net.Socket>();
let nextConn = 1;

function fatal(code: string, cause: string): never {
    log(`error ${code}: ${cause}`);
    send({ type: 'host_error', code, cause });
    cleanup();
    // Give Chrome a moment to read the error before the pipe closes.
    setTimeout(() => process.exit(1), 100);
    throw new Error(cause);
}

function cleanup(): void {
    for (const s of conns.values()) s.destroy();
    conns.clear();
    try { server?.close(); } catch { /* closing */ }
    if (sockPath) { try { fs.unlinkSync(sockPath); } catch { /* gone */ } }
}

async function isLive(p: string): Promise<boolean> {
    return new Promise(resolve => {
        const s = net.connect(p);
        const done = (v: boolean) => { s.destroy(); resolve(v); };
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
        setTimeout(() => done(false), 500);
    });
}

async function open(profileId: string): Promise<void> {
    if (!/^[a-z0-9]{8}$/.test(profileId)) fatal('BAD_INIT', 'invalid profile id');
    const dir = runtimeDir();
    const problem = checkRuntimeDir(dir);
    if (problem) fatal('RUNTIME_DIR', problem);
    const p = socketPath(browserArg, profileId);
    if (Buffer.byteLength(p) > 100) fatal('SOCKET_PATH', `socket path too long (${p.length} bytes); set BOOKMARKS_THUMBNAILS_RUNTIME_DIR to a shorter folder`);
    if (fs.existsSync(p)) {
        if (await isLive(p)) fatal('ALREADY_RUNNING', `another helper already serves ${path.basename(p)}`);
        fs.unlinkSync(p); // stale
    }
    sockPath = p;
    server = net.createServer(onClient);
    server.on('error', err => fatal('SOCKET', err.message));
    await new Promise<void>(resolve => server!.listen(p, resolve));
    fs.chmodSync(p, 0o600);
    log(`listening ${p} (host ${VERSION}, ${browserArg})`);
    send({ type: 'host_ready', hostVersion: VERSION, socket: p });
}

function onClient(sock: net.Socket): void {
    if (conns.size >= MAX_CONNECTIONS) {
        sock.end(JSON.stringify({ v: 1, id: 0, ok: false, error: { code: 'RATE_LIMITED', message: `At most ${MAX_CONNECTIONS} agents can be connected at once.`, fix: 'Close another agent session and try again.', retry: 'after_seconds', retryAfterSeconds: 30, docUrl: '' } }) + '\n');
        return;
    }
    const conn = nextConn++;
    conns.set(conn, sock);
    send({ type: 'conn_open', conn });
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
        buf += chunk;
        if (Buffer.byteLength(buf) > MAX_REQUEST_BYTES && !buf.includes('\n')) {
            sock.write(JSON.stringify({ v: 1, id: 0, ok: false, error: { code: 'TOO_LARGE', message: `Requests are limited to ${MAX_REQUEST_BYTES} bytes.`, fix: 'Send less at once.', retry: 'never', docUrl: '' } }) + '\n');
            buf = '';
            sock.destroy();
            return;
        }
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) {
                sock.write(JSON.stringify({ v: 1, id: 0, ok: false, error: { code: 'TOO_LARGE', message: `Requests are limited to ${MAX_REQUEST_BYTES} bytes.`, fix: 'Send less at once.', retry: 'never', docUrl: '' } }) + '\n');
                continue;
            }
            let req: unknown;
            try { req = JSON.parse(line); } catch {
                sock.write(JSON.stringify({ v: 1, id: 0, ok: false, error: { code: 'INVALID_REQUEST', message: 'Each line must be one JSON object.', fix: 'Send one JSON request per line.', retry: 'never', docUrl: '' } }) + '\n');
                continue;
            }
            send({ type: 'request', conn, req });
        }
    });
    const close = () => {
        if (!conns.has(conn)) return;
        conns.delete(conn);
        send({ type: 'conn_closed', conn });
    };
    sock.on('close', close);
    sock.on('error', close);
}

function onExtension(m: ExtensionToHost): void {
    switch (m?.type) {
        case 'init':
            if (server) return;
            open(String(m.profileId)).catch(err => log(`open failed: ${err instanceof Error ? err.message : err}`));
            return;
        case 'response': {
            const s = conns.get(m.conn);
            if (s && !s.destroyed) s.write(JSON.stringify(m.res) + '\n');
            return;
        }
        case 'close_conn':
            conns.get(m.conn)?.end();
            return;
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

let inbuf = Buffer.alloc(0);
process.stdin.on('data', (d: Buffer) => {
    inbuf = Buffer.concat([inbuf, d]);
    while (inbuf.length >= 4) {
        const n = inbuf.readUInt32LE(0);
        if (n > 16 * 1024 * 1024) { fatal('BAD_FRAME', 'message from the browser is too large'); }
        if (inbuf.length < 4 + n) break;
        const raw = inbuf.subarray(4, 4 + n).toString('utf8');
        inbuf = inbuf.subarray(4 + n);
        try { onExtension(JSON.parse(raw) as ExtensionToHost); } catch (err) { log(`bad message: ${err instanceof Error ? err.message : err}`); }
    }
});
// Chrome closes stdin when the extension disconnects or the browser exits.
process.stdin.on('end', () => { log('browser disconnected'); cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
log(`start pid=${process.pid} origin=${process.argv.find(a => a.startsWith('chrome-extension://')) ?? '?'}`);
