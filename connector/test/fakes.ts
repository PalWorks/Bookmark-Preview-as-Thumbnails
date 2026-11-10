// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any -- test fakes stand in for Workers runtime types */
// In-memory stand-ins for Durable Object storage, hibernatable WebSockets and
// namespaces, enough to run the connector's logic under plain Node.
import { LinkObject } from '../src/link.ts';
import { AuthLimiter } from '../src/limiter.ts';

export function memoryStorage() {
    const store = new Map<string, unknown>();
    let alarm: number | null = null;
    return {
        store,
        get alarmAt() { return alarm; },
        async get<T>(k: string) { return structuredClone(store.get(k)) as T | undefined; },
        async put(k: string, v: unknown) { store.set(k, structuredClone(v)); },
        async delete(k: string) { return store.delete(k); },
        async list<T>(o: { prefix?: string } = {}) {
            return new Map([...store].filter(([k]) => !o.prefix || k.startsWith(o.prefix))) as Map<string, T>;
        },
        async getAlarm() { return alarm; },
        async setAlarm(t: number) { alarm = t; },
    };
}

export class FakeSocket {
    sent: any[] = [];
    closed: { code?: number; reason?: string } | null = null;
    private att: unknown = null;
    /** Called for each frame the Worker sends (lets a test play the browser). */
    onSend?: (msg: any) => void;
    send(data: string) {
        if (this.closed) throw new Error('closed');
        const msg = JSON.parse(data);
        this.sent.push(msg);
        this.onSend?.(msg);
    }
    close(code?: number, reason?: string) { this.closed ??= { code, reason }; }
    serializeAttachment(v: unknown) { this.att = structuredClone(v); }
    deserializeAttachment() { return structuredClone(this.att); }
}

export function linkState() {
    const sockets: FakeSocket[] = [];
    return {
        sockets,
        storage: memoryStorage(),
        acceptWebSocket(ws: FakeSocket) { sockets.push(ws); },
        getWebSockets() { return sockets.filter((s) => !s.closed); },
    };
}

/** A namespace of real objects over fake state, keyed by name. */
export function namespace<T extends { fetch(r: Request): Promise<Response> }>(make: () => T) {
    const objects = new Map<string, T>();
    return {
        objects,
        idFromName: (name: string) => name,
        get(id: unknown) {
            const name = String(id);
            if (!objects.has(name)) objects.set(name, make());
            const obj = objects.get(name)!;
            return { fetch: (input: string | Request, init?: RequestInit) => obj.fetch(input instanceof Request ? input : new Request(input, init)) };
        },
    };
}

export const SECRET = 'test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
export const LINK_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
export const LINK_SECRET = 'S'.repeat(43);

export function makeEnv() {
    const states = new Map<LinkObject, ReturnType<typeof linkState>>();
    const LINK = namespace(() => {
        const st = linkState();
        const obj = new LinkObject(st as any);
        states.set(obj, st);
        return obj;
    });
    const AUTH_LIMITER = namespace(() => new AuthLimiter({ storage: memoryStorage() }));
    const env = { LINK, AUTH_LIMITER, CLIENT_ID_SECRET: SECRET };
    /** Connect a fake browser to a link and say hello. */
    async function browser(linkId = LINK_ID, answer?: (req: any, via: string) => any) {
        const obj = LINK.get(linkId) && LINK.objects.get(linkId)!;
        const ws = new FakeSocket();
        obj.accept(ws as any, linkId);
        if (answer) {
            ws.onSend = (msg) => {
                if (msg.type !== 'request') return;
                const res = answer(msg.req, msg.via);
                queueMicrotask(() => void obj.webSocketMessage(ws as any, JSON.stringify({ type: 'response', rid: msg.rid, res })));
            };
        }
        await obj.webSocketMessage(ws as any, JSON.stringify({ type: 'hello', linkId, secret: LINK_SECRET, extVersion: '1.7.0', protocolVersion: 1 }));
        return { ws, obj, state: states.get(obj)! };
    }
    return { env, browser, LINK, AUTH_LIMITER };
}
