// SPDX-License-Identifier: AGPL-3.0-only
//
// Talks to the extension through the host's socket: finds the live browser
// profile, says hello, keeps the pairing token (0600 file), and turns every
// failure into a BridgeError with a fix.
import fs from 'node:fs';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
    PROTOCOL_VERSION, bridgeError,
    type BridgeError, type ClientResponse, type RequestType,
} from '../../src/lib/bridge/protocol.ts';
import { runtimeDir, tokenFile, verifyRuntimeDir } from './paths.ts';

export interface Target { browser: string; profileId: string; socket: string }
interface TokenStore {
    profiles: Record<string, { token: string; clientId: string; pairedAt: string }>;
    /** Pairings started but not finished, per profile: the random id the code must come with. */
    pending?: Record<string, { pairingId: string; at: string }>;
}

export class BridgeFailure extends Error {
    constructor(public readonly error: BridgeError) { super(error.message); }
}

const keyOf = (t: { browser: string; profileId: string }) => `${t.browser}-${t.profileId}`;

export function readTokens(): TokenStore {
    try {
        const raw = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) as TokenStore;
        return raw && typeof raw.profiles === 'object' ? raw : { profiles: {} };
    } catch {
        return { profiles: {} };
    }
}

export function writeTokens(store: TokenStore): void {
    const file = tokenFile();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
}

async function isLive(socket: string): Promise<boolean> {
    return new Promise(resolve => {
        const s = net.connect(socket);
        const done = (v: boolean) => { s.destroy(); resolve(v); };
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
        setTimeout(() => done(false), 700);
    });
}

/** Live hosts, one per running browser profile with the switch on. */
export async function liveTargets(): Promise<Target[]> {
    const dir = runtimeDir();
    const problem = verifyRuntimeDir(dir);
    if (problem) {
        throw new BridgeFailure(bridgeError('NOT_CONNECTED', `Refusing to use ${dir}: ${problem}.`, {
            fix: 'Remove that folder, or set BOOKMARKS_THUMBNAILS_RUNTIME_DIR to the folder Chrome uses (run doctor in a desktop terminal), then try again.',
        }));
    }
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const out: Target[] = [];
    for (const n of names) {
        const m = /^([a-z]{2,12})-([a-z0-9]{8})\.sock$/.exec(n);
        if (!m) continue;
        const socket = path.join(dir, n);
        try {
            const st = fs.lstatSync(socket);
            if (!st.isSocket() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) continue;
        } catch { continue; }
        if (await isLive(socket)) out.push({ browser: m[1], profileId: m[2], socket });
    }
    return out;
}

/**
 * The profile to talk to. A paired client sticks to the profile it paired with
 * and never silently switches.
 */
export async function chooseTarget(opts: { browser?: string; profile?: string } = {}): Promise<Target> {
    const live = await liveTargets();
    const filtered = live.filter(t => (!opts.browser || t.browser === opts.browser) && (!opts.profile || t.profileId === opts.profile));
    if (opts.browser || opts.profile) {
        if (filtered.length === 1) return filtered[0];
        if (!filtered.length) throw new BridgeFailure(bridgeError('NOT_CONNECTED', `No browser profile ${opts.profile ?? ''} is connected.`, { context: { live: live.map(keyOf) } }));
    }
    const paired = Object.keys(readTokens().profiles);
    if (paired.length === 1 && !opts.browser && !opts.profile) {
        const t = live.find(x => keyOf(x) === paired[0]);
        if (t) return t;
        throw new BridgeFailure(bridgeError('NOT_CONNECTED', `The browser profile this agent paired with (${paired[0]}) is not connected. Open that Chrome profile with Connect coding agents turned on (extension menu > Connect Claude or ChatGPT).`, { context: { paired: paired[0], live: live.map(keyOf) } }));
    }
    const pool = filtered.length ? filtered : live;
    if (pool.length === 1) return pool[0];
    if (!pool.length) throw new BridgeFailure(bridgeError('NOT_CONNECTED', 'No browser is connected.'));
    throw new BridgeFailure(bridgeError('AMBIGUOUS_TARGET', 'Several browser profiles are connected.', {
        context: { targets: pool.map(t => ({ browser: t.browser, profile: t.profileId })) },
    }));
}

/** One connection: hello first, then requests with the stored token. */
export class Connection {
    private sock: net.Socket | null = null;
    private buf = '';
    private nextId = 1;
    private waiting = new Map<number, (r: ClientResponse) => void>();
    hello?: Record<string, unknown>;

    constructor(public readonly target: Target, private readonly clientName: string, private readonly packageVersion: string) { }

    async open(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const s = net.connect(this.target.socket);
            s.once('connect', () => resolve());
            s.once('error', err => reject(new BridgeFailure(bridgeError('NOT_CONNECTED', `Could not reach the browser: ${err.message}`))));
            s.setEncoding('utf8');
            s.on('data', (d: string) => this.onData(d));
            s.on('close', () => {
                for (const fn of this.waiting.values()) fn({ v: 1, id: 0, ok: false, error: bridgeError('NOT_CONNECTED', 'The browser closed the connection.') });
                this.waiting.clear();
            });
            this.sock = s;
        });
        const res = await this.raw('hello', { protocolVersion: PROTOCOL_VERSION, client: this.clientName, package: this.packageVersion });
        if (!res.ok) throw new BridgeFailure(res.error);
        this.hello = res.body;
    }

    private onData(d: string): void {
        this.buf += d;
        let nl: number;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl);
            this.buf = this.buf.slice(nl + 1);
            try {
                const res = JSON.parse(line) as ClientResponse;
                const fn = this.waiting.get(Number(res.id));
                if (fn) { this.waiting.delete(Number(res.id)); fn(res); }
                else if (!res.ok && res.id === 0) for (const w of this.waiting.values()) w(res);
            } catch { /* ignore a malformed line */ }
        }
    }

    raw(type: RequestType, body: Record<string, unknown> = {}, token?: string, timeoutMs = 20000): Promise<ClientResponse> {
        const id = this.nextId++;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.waiting.delete(id);
                resolve({ v: 1, id, ok: false, error: bridgeError('NOT_CONNECTED', 'The browser did not answer in time.', { retry: 'after_seconds', retryAfterSeconds: 5 }) });
            }, timeoutMs);
            this.waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
            this.sock!.write(JSON.stringify({ v: PROTOCOL_VERSION, id, type, body, ...(token ? { token } : {}) }) + '\n');
        });
    }

    /** A request with the stored token. A lost pairing deletes the token. */
    async request(type: RequestType, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const store = readTokens();
        const entry = store.profiles[keyOf(this.target)];
        const res = await this.raw(type, body, entry?.token);
        if (res.ok) return res.body;
        if (res.error.code === 'NOT_PAIRED' && entry) {
            delete store.profiles[keyOf(this.target)];
            writeTokens(store);
            res.error.message = `${res.error.message} The saved pairing was removed; pair again.`;
        }
        throw new BridgeFailure(res.error);
    }

    /** pair with no code starts a prompt in the browser; with the code it stores the token. */
    async pair(code?: string): Promise<Record<string, unknown>> {
        const key = keyOf(this.target);
        let store = readTokens();
        let pairingId = store.pending?.[key]?.pairingId;
        if (!code || !pairingId) {
            pairingId = randomBytes(18).toString('base64url');
            store.pending = { ...(store.pending ?? {}), [key]: { pairingId, at: new Date().toISOString() } };
            writeTokens(store);
        }
        const res = await this.raw('pair', { pairingId, ...(code ? { code } : {}) });
        if (!res.ok) throw new BridgeFailure(res.error);
        const token = String(res.body.token ?? '');
        store = readTokens();
        if (store.pending) delete store.pending[key];
        store.profiles[keyOf(this.target)] = { token, clientId: String(res.body.clientId ?? ''), pairedAt: new Date().toISOString() };
        writeTokens(store);
        const { token: _secret, ...rest } = res.body;
        void _secret;
        return { ...rest, browser: this.target.browser, profile: this.target.profileId };
    }

    close(): void { this.sock?.end(); }
}
