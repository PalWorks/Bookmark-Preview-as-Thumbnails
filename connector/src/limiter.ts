// SPDX-License-Identifier: AGPL-3.0-only
//
// AuthLimiter: authorization attempts per network (design, "Limits": 4 a
// minute). One Durable Object per network, named by an HMAC of the address
// under CLIENT_ID_SECRET, so the address is never stored. A Durable Object runs
// one request at a time, so the count is exact. An alarm deletes the counter
// once its minute is over.

export const AUTH_PER_MINUTE = 4;
const WINDOW_MS = 60_000;

export interface LimiterStorage {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
}

export class AuthLimiter {
    private storage: LimiterStorage;
    now: () => number = () => Date.now();

    constructor(state: { storage: LimiterStorage }) {
        this.storage = state.storage;
    }

    /** POST /take -> {ok, retryAfter?}. Internal only: reached through the binding. */
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST' || new URL(request.url).pathname !== '/take') return new Response('not found', { status: 404 });
        return Response.json(await this.take());
    }

    async take(): Promise<{ ok: boolean; retryAfter?: number }> {
        const t = this.now();
        const c = await this.storage.get<{ start: number; count: number }>('c');
        const cur = c && t - c.start < WINDOW_MS ? c : { start: t, count: 0 };
        if (cur.count >= AUTH_PER_MINUTE) return { ok: false, retryAfter: Math.ceil((cur.start + WINDOW_MS - t) / 1000) };
        await this.storage.put('c', { start: cur.start, count: cur.count + 1 });
        if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(cur.start + WINDOW_MS);
        return { ok: true };
    }

    async alarm(): Promise<void> {
        const c = await this.storage.get<{ start: number }>('c');
        if (!c) return;
        if (this.now() - c.start >= WINDOW_MS) await this.storage.delete('c');
        else await this.storage.setAlarm(c.start + WINDOW_MS);
    }
}

/** IPv6 addresses count as their /64 network; IPv4 as the address. */
export function networkOf(ip: string): string {
    if (!ip.includes(':')) return ip;
    const [head] = ip.split('%');
    const parts = head.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
    const full = parts.length > 1 ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
    return full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
