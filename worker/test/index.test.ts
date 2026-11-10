// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any */
// Worker logic tests, plain Node (node --test strips the types). Resend is
// never called: global fetch is replaced for each test.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { buildEmail, ipKey, networkOf } from '../src/index.ts';
import { FeedbackLimiter, DAILY_MAX, NETWORK_WINDOW_MS } from '../src/limiter.ts';

const ORIGIN = 'chrome-extension://eedekafhclngkhhkcocblnllkbodgnhj';

/** Durable Object storage in memory, enough for FeedbackLimiter. */
function memoryStorage() {
    const store = new Map<string, unknown>();
    let alarm: number | null = null;
    return {
        store,
        async get<T>(k: string) { return store.get(k) as T | undefined; },
        async put(k: string, v: unknown) { store.set(k, v); },
        async delete(k: string) { return store.delete(k); },
        async list<T>(o: { prefix?: string } = {}) {
            return new Map([...store].filter(([k]) => !o.prefix || k.startsWith(o.prefix))) as Map<string, T>;
        },
        async getAlarm() { return alarm; },
        async setAlarm(t: number) { alarm = t; },
    };
}

/** The LIMITER binding: one real FeedbackLimiter over memory storage. */
function limiterNamespace(storage = memoryStorage()) {
    const instance = new FeedbackLimiter({ storage });
    let queue: Promise<unknown> = Promise.resolve();
    return {
        storage,
        instance,
        idFromName: (name: string) => name,
        // A Durable Object handles one request at a time; model that with a queue,
        // so the concurrency test proves the limiter logic, not luck in scheduling.
        get: () => ({
            fetch: (url: string, init: RequestInit) => {
                const run = queue.then(() => instance.fetch(new Request(url, init)));
                queue = run.catch(() => undefined);
                return run;
            },
        }),
    };
}

let limiter: ReturnType<typeof limiterNamespace>;
let kv: ReturnType<typeof memoryStorage>;
let sent: { url: string; body: any }[];
const realFetch = globalThis.fetch;

function env(overrides: Record<string, unknown> = {}) {
    return {
        RESEND_API_KEY: 're_test',
        IP_HASH_SECRET: 'test-secret',
        LIMITER: limiter,
        ALLOWED_ORIGINS: ORIGIN,
        FEEDBACK_FROM: 'from@example.com',
        FEEDBACK_TO: 'to@example.com',
        ...overrides,
    } as any;
}

function post(body: unknown, ip = '203.0.113.7') {
    return new Request('https://relay.example/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'cf-ipcountry': 'AU', origin: ORIGIN },
        body: JSON.stringify(body),
    });
}

const good = { category: 'bug', message: 'The tabs vanish after a reload.', diagnostics: { version: '1.8.0' } };

beforeEach(() => {
    limiter = limiterNamespace();
    kv = limiter.storage;
    sent = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return new Response('{}', { status: 200 });
    }) as any;
});

test.after(() => {
    globalThis.fetch = realFetch;
});

test('a valid message is sent, with no country in it', async () => {
    const res = await worker.fetch(post(good), env());
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].body.html, /country|AU/);
});

test('the counter is named by a keyed hash, never the IP', async () => {
    await worker.fetch(post(good), env());
    const keys = [...kv.store.keys()];
    assert.ok(keys.every((k) => !k.includes('203.0.113.7')));
    assert.ok(keys.includes(`n:${await ipKey('test-secret', '203.0.113.7')}`));
});

test('ipKey depends on the secret', async () => {
    assert.notEqual(await ipKey('a', '203.0.113.7'), await ipKey('b', '203.0.113.7'));
    assert.match(await ipKey('a', '203.0.113.7'), /^[0-9a-f]{32}$/);
});

test('fails closed without IP_HASH_SECRET', async () => {
    const res = await worker.fetch(post(good), env({ IP_HASH_SECRET: '' }));
    assert.equal(res.status, 500);
    assert.ok((await res.json()).error);
    assert.equal(sent.length, 0);
    assert.equal(kv.store.size, 0);
});

test('five per network per hour, then 429', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await worker.fetch(post(good), env())).status, 200);
    assert.equal((await worker.fetch(post(good), env())).status, 429);
    assert.equal((await worker.fetch(post(good, '198.51.100.1'), env())).status, 200);
});

test('the daily global cap answers 503', async () => {
    kv.store.set(`d:${new Date().toISOString().slice(0, 10)}`, DAILY_MAX);
    const res = await worker.fetch(post(good), env());
    assert.equal(res.status, 503);
    assert.ok((await res.json()).error);
    assert.equal(sent.length, 0);
});

test('the burst binding refuses before the limiter is touched', async () => {
    const res = await worker.fetch(post(good), env({ BURST: { limit: async () => ({ success: false }) } }));
    assert.equal(res.status, 429);
    assert.equal(kv.store.size, 0);
});

test('a failing burst binding falls back to the limiter', async () => {
    const res = await worker.fetch(post(good), env({ BURST: { limit: async () => { throw new Error('down'); } } }));
    assert.equal(res.status, 200);
});

test('a Resend timeout answers 504 with an error body', async () => {
    globalThis.fetch = (async () => {
        throw new DOMException('timed out', 'TimeoutError');
    }) as any;
    const res = await worker.fetch(post(good), env());
    assert.equal(res.status, 504);
    assert.ok((await res.json()).error);
});

test('a Resend failure answers 502 without echoing the provider', async () => {
    globalThis.fetch = (async () => new Response('{"account":"secret"}', { status: 500 })) as any;
    const res = await worker.fetch(post(good), env());
    assert.equal(res.status, 502);
    assert.doesNotMatch(await res.text(), /secret/);
});

test('the honeypot is answered 200 and dropped', async () => {
    const res = await worker.fetch(post({ ...good, website: 'http://spam' }), env());
    assert.equal(res.status, 200);
    assert.equal(sent.length, 0);
});

test('buildEmail escapes HTML', () => {
    const { html } = buildEmail({ category: 'bug', message: '<script>x</script>' } as any);
    assert.doesNotMatch(html, /<script>/);
});

// Review of PR #11 (2026-11-09): message line breaks, non-object bodies, byte-counted size.
test('keeps the line breaks of a multi-line message', async () => {
    const res = await worker.fetch(post({ category: 'bug', message: 'Step one\r\nStep two\n\n\n\nStep three' }), env());
    assert.equal(res.status, 200);
    const html: string = sent[0].body.html;
    assert.match(html, /Step one\nStep two\n\nStep three/);
    assert.doesNotMatch(sent[0].body.subject, /\n/);
});

test('a JSON body that is not an object is a 400, not a 500', async () => {
    for (const body of ['null', '"text"', '[1,2]']) {
        const res = await worker.fetch(new Request('https://relay.example/feedback', {
            method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body,
        }), env());
        assert.equal(res.status, 400, body);
    }
    assert.equal(sent.length, 0);
});

test('size is counted in bytes, so multibyte text cannot slip past the cap', async () => {
    const res = await worker.fetch(post({ category: 'bug', message: '€'.repeat(6000) }), env());
    assert.equal(res.status, 413);
    assert.equal(sent.length, 0);
});

// Review of PR #11 (2026-11-09): atomic Durable Object limiter, IPv6 /64, origins, refunds.
test('concurrent requests from one network cannot pass the hourly limit', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => worker.fetch(post(good), env())));
    assert.equal(results.filter((r) => r.status === 200).length, 5);
    assert.equal(results.filter((r) => r.status === 429).length, 15);
    assert.equal(sent.length, 5);
});

test('a missing or failing limiter refuses rather than sending unlimited', async () => {
    const broken = { idFromName: () => 'x', get: () => ({ fetch: async () => { throw new Error('down'); } }) };
    for (const LIMITER of [undefined, broken]) {
        const res = await worker.fetch(post(good), env({ LIMITER }));
        assert.equal(res.status, 503);
    }
    assert.equal(sent.length, 0);
});

test('IPv6 addresses in one /64 share an allowance', async () => {
    assert.equal(networkOf('2001:db8:aa:bb:1::1'), '2001:db8:aa:bb::/64');
    assert.equal(networkOf('2001:db8:aa:bb::ffff'), '2001:db8:aa:bb::/64');
    assert.equal(networkOf('2001:0db8::1'), '2001:db8:0:0::/64');
    assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
    for (let i = 1; i <= 5; i++) assert.equal((await worker.fetch(post(good, `2001:db8:aa:bb::${i}`), env())).status, 200);
    assert.equal((await worker.fetch(post(good, '2001:db8:aa:bb:9:9:9:9'), env())).status, 429);
});

test('a page from another origin is refused before any work', async () => {
    const req = new Request('https://relay.example/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', origin: 'https://evil.example' },
        body: JSON.stringify(good),
    });
    const res = await worker.fetch(req, env());
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(sent.length, 0);
    assert.equal(kv.store.size, 0);
});

test('our extension origin is echoed back for CORS', async () => {
    const res = await worker.fetch(new Request('https://relay.example/feedback', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env());
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('a provider-side failure (5xx) gives the allowance back', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as any;
    for (let i = 0; i < 7; i++) assert.equal((await worker.fetch(post(good), env())).status, 502);
    const who = await ipKey('test-secret', '203.0.113.7');
    assert.equal((kv.store.get(`n:${who}`) as { count: number }).count, 0);
    assert.equal(kv.store.get(`d:${new Date().toISOString().slice(0, 10)}`), 0);
});

test('the alarm deletes stale counters so nothing outlives a day', async () => {
    const now = Date.now();
    await limiter.instance.take('a'.repeat(32), now - NETWORK_WINDOW_MS - 1000);
    kv.store.set('d:2000-01-01', 3);
    await limiter.instance.take('b'.repeat(32), now);
    await limiter.instance.sweep(now);
    assert.ok(!kv.store.has(`n:${'a'.repeat(32)}`));
    assert.ok(!kv.store.has('d:2000-01-01'));
    assert.ok(kv.store.has(`n:${'b'.repeat(32)}`));
});

test('rejection paths answer before any side effect', async () => {
    const raw = (body: string, headers: Record<string, string> = {}) => new Request('https://relay.example/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers }, body,
    });
    const cases: [Request, number][] = [
        [raw(JSON.stringify(good), { 'content-type': 'text/plain' }), 415],
        [raw('{bad'), 400],
        [raw(JSON.stringify({ category: 'bug', message: 'hi' })), 400],
        [raw(JSON.stringify({ ...good, replyTo: 'not-an-email' })), 400],
        [raw('x'.repeat(17000)), 413],
        [raw(JSON.stringify(good), { 'content-length': '99999' }), 413],
        [new Request('https://relay.example/elsewhere', { method: 'POST' }), 404],
        [new Request('https://relay.example/feedback', { method: 'GET' }), 405],
    ];
    for (const [req, status] of cases) assert.equal((await worker.fetch(req, env())).status, status);
    assert.equal(sent.length, 0);
    assert.equal(kv.store.size, 0);
});

test('diagnostics are capped and escaped; an unknown category becomes other; reply_to is forwarded', async () => {
    const diagnostics = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}<b>`, 'v<i>']));
    await worker.fetch(post({ ...good, category: 'weird', replyTo: 'me@example.com', diagnostics }), env());
    assert.match(sent[0].body.subject, /other:/);
    assert.deepEqual(sent[0].body.reply_to, ['me@example.com']);
    assert.ok((sent[0].body.html.match(/<tr>/g) || []).length <= 12);
    assert.doesNotMatch(sent[0].body.html, /<b>|<i>/);
});

// Second review pass (2026-11-09).
test('a 4xx from the provider is not refunded, so scripts cannot retry for free', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 422 })) as any;
    for (let i = 0; i < 5; i++) assert.equal((await worker.fetch(post(good), env())).status, 502);
    assert.equal((await worker.fetch(post(good), env())).status, 429);
});

test('a timeout is not refunded: the provider may have sent it', async () => {
    globalThis.fetch = (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as any;
    await worker.fetch(post(good), env());
    const who = await ipKey('test-secret', '203.0.113.7');
    assert.equal((kv.store.get(`n:${who}`) as { count: number }).count, 1);
});

test('a refund after the window reset leaves the new window alone', async () => {
    const who = 'c'.repeat(32);
    const now = Date.now();
    const first = await limiter.instance.take(who, now - NETWORK_WINDOW_MS - 1);
    assert.ok(first.ok);
    await limiter.instance.take(who, now);
    if (first.ok) await limiter.instance.refund(who, first.day, first.start);
    assert.equal((kv.store.get(`n:${who}`) as { count: number }).count, 1);
});

test('the runtime alarm reads the clock itself (it is passed alarm info, not a time)', async () => {
    kv.store.set('d:2000-01-01', 3);
    await (limiter.instance as any).alarm({ retryCount: 0, isRetry: false });
    assert.ok(!kv.store.has('d:2000-01-01'));
});

test('odd address forms map to the right network', () => {
    assert.equal(networkOf('::ffff:198.51.100.4'), '198.51.100.4');
    assert.equal(networkOf('fe80::1%eth0'), 'fe80:0:0:0::/64');
});

test('a chunked oversized body is refused without reading it all', async () => {
    const big = new ReadableStream({
        start(c) { for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024))); c.close(); },
    });
    const req = new Request('https://relay.example/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: big, duplex: 'half',
    } as any);
    assert.equal((await worker.fetch(req, env())).status, 413);
});

test('bidi overrides and other invisible controls are stripped from the message', async () => {
    await worker.fetch(post({ ...good, message: 'Pay \u202Eevil\u202C now\u0085 please' }), env());
    assert.doesNotMatch(sent[0].body.html, /[\u202A-\u202E\u0085]/);
});

test('display-name and list addresses are refused as reply addresses', async () => {
    for (const replyTo of ['A <a@b.co>', 'a@b.co,c@d.co', '"q"@b.co']) {
        assert.equal((await worker.fetch(post({ ...good, replyTo }), env())).status, 400, replyTo);
    }
});

// ── Usage statistics (D27) ───────────────────────────────────────────────────

const CID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
function postEvents(body: unknown, origin: string | null = ORIGIN) {
    return new Request('https://relay.example/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
    });
}
const statsEnv = () => env({ GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'ga-secret', POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://ph.example' });

test('events go to GA4 and PostHog with only safe values; links, titles and spaces are dropped', async () => {
    const res = await worker.fetch(postEvents({
        cid: CID, sid: 1700000000, v: '1.8.0',
        events: [
            { n: 'ask_ai_send', p: { provider: 'groq', folder: true, turn: 2, title: 'My secret folder', url: 'https://bank.example/x?y=1' }, ago: 50 },
            { n: 'Bad Name', p: {} },
        ],
    }), statsEnv());
    assert.equal(res.status, 204);
    assert.equal(sent.length, 2);
    const ga = sent.find((s) => s.url.startsWith('https://www.google-analytics.com/mp/collect'))!;
    assert.match(ga.url, /measurement_id=G-TEST&api_secret=ga-secret/);
    assert.equal(ga.body.client_id, CID);
    assert.deepEqual(ga.body.events.map((e: any) => e.name), ['ask_ai_send']);
    assert.deepEqual(ga.body.events[0].params, { provider: 'groq', folder: true, turn: 2, engagement_time_msec: 1, session_id: 1700000000, ext_version: '1.8.0' });
    const ph = sent.find((s) => s.url === 'https://ph.example/batch/')!;
    assert.equal(ph.body.api_key, 'phc_test');
    assert.equal(ph.body.batch[0].distinct_id, CID);
    assert.equal(ph.body.batch[0].properties.$process_person_profile, false);
    assert.equal(ph.body.batch[0].properties.title, undefined);
    assert.doesNotMatch(JSON.stringify(sent), /203\.0\.113\.7|secret folder|bank\.example/);
});

test('events: development copies are marked, unknown origins and bad batches are refused, no keys means nothing is sent', async () => {
    await worker.fetch(postEvents({ cid: CID, v: '1.8.0', dev: true, events: [{ n: 'app_open' }] }), statsEnv());
    assert.equal(sent.find((s) => s.url.includes('google-analytics'))!.body.events[0].params.debug_mode, 1);
    assert.equal((await worker.fetch(postEvents({ cid: CID, v: '1.8.0', events: [{ n: 'app_open' }] }, null), statsEnv())).status, 403);
    assert.equal((await worker.fetch(postEvents({ cid: 'not-an-id', v: '1.8.0', events: [{ n: 'app_open' }] }), statsEnv())).status, 400);
    sent = [];
    assert.equal((await worker.fetch(postEvents({ cid: CID, v: '1.8.0', events: [{ n: 'app_open' }] }), env())).status, 204);
    assert.equal(sent.length, 0);
});
