// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FeedbackLimiter: the relay's rate limits, in one Durable Object.
 *
 * Why a Durable Object (review of PR #11, 2026-11-09): KV counters are read, then
 * written, with no atomicity, and KV accepts about one write a second per key, so
 * under a flood every request read the same count and passed. A Durable Object
 * runs one request at a time and its storage reads and writes cannot interleave,
 * so a count here is exact.
 *
 * One instance ("global") holds every counter. Feedback is low volume, so a
 * single serialised counter is plenty and keeps the daily cap exact too.
 *
 * Stored: one counter per network (named by an HMAC, never the IP) for the
 * current hour, and one counter for everyone for the current UTC day. An alarm
 * deletes stale counters, so nothing outlives 26 hours.
 */

export const NETWORK_MAX = 5;
export const NETWORK_WINDOW_MS = 60 * 60 * 1000;
export const DAILY_MAX = 300;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

interface Counter {
    count: number;
    start: number;
}

/** The slice of Durable Object storage this class uses (also faked in tests). */
export interface LimiterStorage {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
}

export type TakeResult = { ok: true } | { ok: false; reason: 'network' | 'daily' };

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export class FeedbackLimiter {
    private storage: LimiterStorage;

    constructor(state: { storage: LimiterStorage }) {
        this.storage = state.storage;
    }

    /** POST {op: 'take' | 'refund', who}. Internal only: reached through the binding. */
    async fetch(request: Request): Promise<Response> {
        let body: { op?: string; who?: string };
        try {
            body = (await request.json()) as { op?: string; who?: string };
        } catch {
            return new Response('bad request', { status: 400 });
        }
        const who = typeof body.who === 'string' ? body.who : '';
        if (!/^[0-9a-f]{32}$/.test(who)) return new Response('bad request', { status: 400 });
        if (body.op === 'take') return Response.json(await this.take(who, Date.now()));
        if (body.op === 'refund') {
            await this.refund(who, Date.now());
            return Response.json({ ok: true });
        }
        return new Response('bad request', { status: 400 });
    }

    /** Count one message for this network and for the day, or refuse it. */
    async take(who: string, now: number): Promise<TakeResult> {
        const netKey = `n:${who}`;
        const dayKey = `d:${dayOf(now)}`;
        const stored = await this.storage.get<Counter>(netKey);
        const net = stored && now - stored.start < NETWORK_WINDOW_MS ? stored : { count: 0, start: now };
        if (net.count >= NETWORK_MAX) return { ok: false, reason: 'network' };
        const day = (await this.storage.get<number>(dayKey)) ?? 0;
        if (day >= DAILY_MAX) return { ok: false, reason: 'daily' };
        await this.storage.put(netKey, { count: net.count + 1, start: net.start });
        await this.storage.put(dayKey, day + 1);
        if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(now + SWEEP_EVERY_MS);
        return { ok: true };
    }

    /** Give the allowance back when the message could not be sent. */
    async refund(who: string, now: number): Promise<void> {
        const netKey = `n:${who}`;
        const dayKey = `d:${dayOf(now)}`;
        const net = await this.storage.get<Counter>(netKey);
        if (net && net.count > 0) await this.storage.put(netKey, { count: net.count - 1, start: net.start });
        const day = (await this.storage.get<number>(dayKey)) ?? 0;
        if (day > 0) await this.storage.put(dayKey, day - 1);
    }

    /** Delete counters past their window; re-arm while any remain. */
    async alarm(now = Date.now()): Promise<void> {
        const today = `d:${dayOf(now)}`;
        let remaining = 0;
        for (const [key, value] of await this.storage.list<Counter | number>({ prefix: 'n:' })) {
            const c = value as Counter;
            if (now - c.start >= NETWORK_WINDOW_MS) await this.storage.delete(key);
            else remaining++;
        }
        for (const key of (await this.storage.list<number>({ prefix: 'd:' })).keys()) {
            if (key !== today) await this.storage.delete(key);
            else remaining++;
        }
        if (remaining > 0) await this.storage.setAlarm(now + SWEEP_EVERY_MS);
    }
}
