// SPDX-License-Identifier: AGPL-3.0-only
/**
 * feedback worker
 *
 * Relays the extension's in-product feedback form to email via Resend.
 *
 * The extension cannot call Resend directly: a published CRX is a zip anyone
 * can unpack, so an API key inside it is a public key. This Worker holds the
 * key instead. It is the only server of ours the extension talks to; the
 * others are the pages it captures and, only if the user sets one up, the
 * AI provider they chose.
 *
 * It accepts one POST from our extension's own pages, validates it hard, rate
 * limits per network, and sends. It stores no message content. The only things
 * it writes are rate-limit counters in the FeedbackLimiter Durable Object
 * (src/limiter.ts): one per network, named by a keyed hash of the address rather
 * than the address, and one for everyone together; none outlives 26 hours.
 */

import { FeedbackLimiter, type TakeResult } from './limiter.ts';

export { FeedbackLimiter };

export interface Env {
    RESEND_API_KEY: string;
    /** Keys the HMAC that names a network in its counter, so no IP is ever stored. */
    IP_HASH_SECRET: string;
    /** The FeedbackLimiter Durable Object: atomic rate-limit counters. */
    LIMITER: DurableObjectNamespace;
    /** Comma-separated origins allowed to post (our extension ids). */
    ALLOWED_ORIGINS: string;
    /** Cloudflare's rate-limit binding: a burst limit per network, per data centre. */
    BURST?: { limit: (o: { key: string }) => Promise<{ success: boolean }> };
    /** Verified Resend sender, e.g. feedback.ThumbnailBookmarks@palworks.ai */
    FEEDBACK_FROM: string;
    /** Destination mailbox, e.g. support@palworks.ai */
    FEEDBACK_TO: string;
}

// Limits are deliberately tight: this endpoint is public and unauthenticated.
const MAX_MESSAGE_CHARS = 4000;
const MIN_MESSAGE_CHARS = 5;
const MAX_EMAIL_CHARS = 254;
const MAX_BODY_BYTES = 16 * 1024;
/** Resend normally answers in well under a second; past this, give up and say so. */
const SEND_TIMEOUT_MS = 8000;

const CATEGORIES = ['bug', 'feature', 'question', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

interface FeedbackPayload {
    category: Category;
    message: string;
    replyTo?: string;
    /** Optional, user-toggled diagnostics. Never contains email addresses. */
    diagnostics?: Record<string, string | number | boolean>;
    /** Honeypot: must be absent or empty. Bots fill every field they see. */
    website?: string;
}

/**
 * Only our extension's pages may post. A web page always sends its Origin with a
 * cross-site JSON POST, so a page cannot make its visitors' browsers post for it.
 * A request with no Origin (a script, curl) is still subject to every limit.
 */
function allowedOrigin(request: Request, env: Env): string | null {
    const origin = request.headers.get('Origin');
    if (!origin) return null;
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
    return origin
        ? {
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Max-Age': '86400',
              Vary: 'Origin',
          }
        : { Vary: 'Origin' };
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
}

/** Collapse anything unexpected into a short, safe, single-line string. */
function clean(value: unknown, maxChars: number): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/**
 * The message keeps its line breaks (steps to reproduce, lists): CRLF becomes LF,
 * control characters other than LF and tab are dropped, runs of spaces and tabs
 * collapse, and at most two blank lines survive in a row.
 */
function cleanMessage(value: unknown, maxChars: number): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\r\n?/g, '\n')
        // Controls (C0 except LF and tab, DEL, C1), line/paragraph separators and
        // bidi overrides, which could make the support email read differently.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, maxChars);
}

/** A plain address only: no display names, lists or quoting the mail provider would refuse. */
function isPlausibleEmail(value: string): boolean {
    return /^[^@\s<>,;"()[\]\\]+@[^@\s.<>,;"()[\]\\]+\.[^@\s<>,;"()[\]\\]+$/.test(value);
}

/** Escape for inclusion in the HTML email body. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * The network an address belongs to, for counting: an IPv4 address as is, an
 * IPv6 address by its /64 prefix. One IPv6 sender usually holds a whole /64 and
 * could otherwise rotate addresses to get a fresh allowance each time.
 */
export function networkOf(rawIp: string): string {
    const ip = rawIp.split('%')[0];
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
    if (mapped) return mapped[1];
    if (!ip.includes(':')) return ip;
    const [head, tail = ''] = ip.toLowerCase().split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const missing = Math.max(0, 8 - left.length - right.length);
    const groups = ip.includes('::') ? [...left, ...Array(missing).fill('0'), ...right] : left;
    return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Name a network without storing its address: HMAC-SHA256 of the network under
 * a secret, so the key cannot be reversed or matched against a list of
 * addresses by anyone without the secret.
 */
export async function ipKey(secret: string, ip: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`ip:${ip}`)));
    return Array.from(mac.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read the body, stopping as soon as it passes the cap, so a chunked upload with
 * no Content-Length is never buffered in full. Null when it is too large.
 */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        all.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder().decode(all);
}

/** Ask the limiter. Any failure is a refusal: the relay never runs unlimited. */
async function limiter(env: Env, op: 'take' | 'refund', who: string, slot?: { day: string; start: number }): Promise<TakeResult | null> {
    try {
        const stub = env.LIMITER.get(env.LIMITER.idFromName('global'));
        const res = await stub.fetch('https://limiter/', { method: 'POST', body: JSON.stringify({ op, who, ...slot }) });
        if (!res.ok) return null;
        return (await res.json()) as TakeResult;
    } catch {
        return null;
    }
}

export function buildEmail(payload: FeedbackPayload) {
    const diagnostics = payload.diagnostics || {};
    const diagnosticRows = Object.entries(diagnostics)
        .map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(String(v))}</td></tr>`)
        .join('');

    const subject = `[Thumbnail Bookmarks feedback] ${payload.category}: ${clean(payload.message, 60)}`;
    const html = `
        <h2>Visual Bookmark Manager with Thumbnail Previews: feedback</h2>
        <p><strong>Category:</strong> ${escapeHtml(payload.category)}</p>
        <p><strong>Reply to (typed by the sender, not verified):</strong> ${payload.replyTo ? escapeHtml(payload.replyTo) : 'not supplied'}</p>
        <hr />
        <p style="white-space: pre-wrap">${escapeHtml(payload.message)}</p>
        <hr />
        <table>${diagnosticRows}</table>
    `;

    return { subject, html };
}

async function handleFeedback(request: Request, env: Env, origin: string | null): Promise<Response> {
    const reply = (body: unknown, status = 200) => json(body, status, origin);
    // Without the secret the counter would have to name the raw IP, which the
    // privacy policy says is never kept. Refuse rather than store it.
    if (!env.IP_HASH_SECRET) {
        return reply({ error: 'Feedback is not available right now. Please try again later.' }, 500);
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        return reply({ error: 'Expected application/json' }, 415);
    }

    // Refuse a declared oversize body before reading it, then count real bytes.
    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > MAX_BODY_BYTES) return reply({ error: 'Payload too large' }, 413);
    const raw = await readCapped(request, MAX_BODY_BYTES);
    if (raw === null) return reply({ error: 'Payload too large' }, 413);

    let parsed: FeedbackPayload;
    try {
        parsed = JSON.parse(raw) as FeedbackPayload;
    } catch {
        return reply({ error: 'Malformed JSON' }, 400);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reply({ error: 'Malformed JSON' }, 400);
    }

    // Honeypot: a real form never fills this, so answer 200 and drop it
    // silently rather than teaching the bot what failed.
    if (clean(parsed.website, 100)) return reply({ ok: true });

    const message = cleanMessage(parsed.message, MAX_MESSAGE_CHARS);
    if (message.length < MIN_MESSAGE_CHARS) return reply({ error: 'Message is too short' }, 400);

    const category = (CATEGORIES as readonly string[]).includes(parsed.category) ? parsed.category : 'other';

    const replyTo = clean(parsed.replyTo, MAX_EMAIL_CHARS);
    if (replyTo && !isPlausibleEmail(replyTo)) {
        return reply({ error: 'That email address does not look right' }, 400);
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const who = await ipKey(env.IP_HASH_SECRET, networkOf(ip));
    if (env.BURST) {
        try {
            const { success } = await env.BURST.limit({ key: who });
            if (!success) return reply({ error: 'Too many messages from this network. Try again later.' }, 429);
        } catch {
            /* the limiter below still holds */
        }
    }
    const taken = await limiter(env, 'take', who);
    if (!taken) return reply({ error: 'Feedback is not available right now. Please try again later.' }, 503);
    if (!taken.ok) {
        return taken.reason === 'network'
            ? reply({ error: 'Too many messages from this network. Try again later.' }, 429)
            : reply({ error: 'Feedback is busy today. Please try again tomorrow.' }, 503);
    }

    const diagnostics: Record<string, string> = {};
    if (parsed.diagnostics && typeof parsed.diagnostics === 'object') {
        for (const [k, v] of Object.entries(parsed.diagnostics).slice(0, 12)) {
            diagnostics[clean(k, 40)] = clean(String(v), 200);
        }
    }

    const { subject, html } = buildEmail({ category: category as Category, message, replyTo, diagnostics });

    let res: Response;
    try {
        res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: env.FEEDBACK_FROM,
                to: [env.FEEDBACK_TO],
                subject,
                html,
                // Lets you hit reply straight from the inbox when the user left an
                // address; Resend omits the header when the array is empty.
                reply_to: replyTo ? [replyTo] : undefined,
            }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
    } catch (e) {
        // A provider that hangs must not hold the form open until the
        // extension's own timeout fires.
        if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
            // The provider may still have sent it: no refund, so no duplicate slot.
            return reply({ error: 'Sending took too long. Please try again later.' }, 504);
        }
        // The request never reached the provider: give the allowance back (best effort).
        await limiter(env, 'refund', who, taken);
        return reply({ error: 'Could not send right now. Please try again later.' }, 502);
    }

    if (!res.ok) {
        // Refund only provider-side failures (429, 5xx). A 4xx means this request
        // was refused as sent; refunding it would let a script retry without limit.
        if (res.status === 429 || res.status >= 500) await limiter(env, 'refund', who, taken);
        // Never echo the provider's response: it can carry account details.
        return reply({ error: 'Could not send right now. Please try again later.' }, 502);
    }

    return reply({ ok: true });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const origin = allowedOrigin(request, env);
        // A browser page we do not know: refuse before any work or counting.
        if (request.headers.get('Origin') && !origin) {
            return json({ error: 'Not allowed' }, 403);
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }
        if (url.pathname === '/health') {
            return json({ ok: true });
        }
        if (url.pathname !== '/feedback') {
            return json({ error: 'Not found' }, 404, origin);
        }
        if (request.method !== 'POST') {
            return json({ error: 'Method not allowed' }, 405, origin);
        }

        try {
            return await handleFeedback(request, env, origin);
        } catch {
            return json({ error: 'Unexpected error' }, 500, origin);
        }
    },
};
