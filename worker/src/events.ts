// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Usage statistics relay (D27). The extension posts small batches of feature events here;
 * this passes them to Google Analytics (Measurement Protocol) and PostHog with keys that
 * never leave the Worker. It stores nothing.
 *
 * Every value is checked again here, whatever the extension sent: event names and keys are
 * short identifiers, values are numbers, booleans or short words without spaces or slashes,
 * so no link, title, search or chat text can pass. The sender's address is not forwarded;
 * only its country (from Cloudflare) goes on. Events from development copies are marked as test
 * traffic (GA4 debug_mode, PostHog `dev`), so reports can filter them out.
 */

export interface EventsEnv {
    GA4_MEASUREMENT_ID?: string;
    GA4_API_SECRET?: string;
    POSTHOG_KEY?: string;
    POSTHOG_HOST?: string;
    /** Burst limit per network for events (Cloudflare rate-limit binding). */
    EVENTS_BURST?: { limit: (o: { key: string }) => Promise<{ success: boolean }> };
}

export const MAX_EVENTS_BODY = 8 * 1024;
const MAX_EVENTS = 20;
const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const KEY = /^[a-z][a-z0-9_]{0,29}$/;
const WORD = /^[A-Za-z0-9_.:-]{0,40}$/;
const CID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}(\.\d{1,4}){1,3}$/;

export interface CleanBatch {
    cid: string;
    sid: number;
    v: string;
    dev: boolean;
    events: Array<{ n: string; p: Record<string, string | number | boolean>; ago: number }>;
}

/** The batch with everything unexpected dropped, or null when it is not a batch at all. */
export function cleanBatch(raw: unknown): CleanBatch | null {
    const b = raw as Record<string, unknown>;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    if (typeof b.cid !== 'string' || !CID.test(b.cid)) return null;
    if (typeof b.v !== 'string' || !VERSION.test(b.v)) return null;
    if (!Array.isArray(b.events)) return null;
    const sid = typeof b.sid === 'number' && Number.isInteger(b.sid) && b.sid > 0 ? b.sid : 0;
    const events: CleanBatch['events'] = [];
    for (const e of b.events.slice(0, MAX_EVENTS) as Array<Record<string, unknown>>) {
        if (!e || typeof e.n !== 'string' || !NAME.test(e.n)) continue;
        const p: Record<string, string | number | boolean> = {};
        const params = e.p && typeof e.p === 'object' && !Array.isArray(e.p) ? (e.p as Record<string, unknown>) : {};
        for (const [k, v] of Object.entries(params).slice(0, 10)) {
            if (!KEY.test(k)) continue;
            if (typeof v === 'boolean') p[k] = v;
            else if (typeof v === 'number' && Number.isFinite(v)) p[k] = v;
            else if (typeof v === 'string' && WORD.test(v)) p[k] = v;
        }
        const ago = typeof e.ago === 'number' && Number.isFinite(e.ago) ? Math.min(Math.max(0, e.ago), 3_600_000) : 0;
        events.push({ n: e.n, p, ago });
    }
    if (!events.length) return null;
    return { cid: b.cid, sid, v: b.v, dev: b.dev === true, events };
}

/** The Measurement Protocol body. engagement_time_msec makes GA count the user as active. */
export function ga4Body(b: CleanBatch, country: string | null, now = Date.now()) {
    return {
        client_id: b.cid,
        non_personalized_ads: true,
        timestamp_micros: now * 1000,
        ...(country ? { user_location: { country_id: country } } : {}),
        user_properties: { ext_version: { value: b.v } },
        events: b.events.map((e) => ({
            name: e.n,
            params: {
                ...e.p,
                engagement_time_msec: 1,
                ...(b.sid ? { session_id: b.sid } : {}),
                ext_version: b.v,
                ...(b.dev ? { debug_mode: 1 } : {}),
            },
        })),
    };
}

/** The PostHog batch body. No person profiles: events stay anonymous. */
export function posthogBody(b: CleanBatch, key: string, country: string | null, now = Date.now()) {
    return {
        api_key: key,
        batch: b.events.map((e) => ({
            event: e.n,
            distinct_id: b.cid,
            timestamp: new Date(now - e.ago).toISOString(),
            properties: {
                ...e.p,
                $process_person_profile: false,
                $geoip_disable: true,
                $session_id: b.sid ? String(b.sid) : undefined,
                ext_version: b.v,
                dev: b.dev,
                ...(country ? { country } : {}),
            },
        })),
    };
}

/** Forward one batch to whichever services have keys. Failures are swallowed. */
export async function forward(b: CleanBatch, env: EventsEnv, country: string | null): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    if (env.GA4_MEASUREMENT_ID && env.GA4_API_SECRET) {
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
        jobs.push(fetch(url, { method: 'POST', body: JSON.stringify(ga4Body(b, country)), signal: AbortSignal.timeout(5000) }));
    }
    if (env.POSTHOG_KEY) {
        const host = (env.POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '');
        jobs.push(fetch(`${host}/batch/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(posthogBody(b, env.POSTHOG_KEY, country)),
            signal: AbortSignal.timeout(5000),
        }));
    }
    await Promise.allSettled(jobs);
}
