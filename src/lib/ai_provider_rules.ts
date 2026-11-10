// SPDX-License-Identifier: AGPL-3.0-only
//
// Provider rules shared by Auto-Tag, Smart Search and Ask AI. Each rule is a measured
// finding ported from the owner's ai-provider-kit (KNOWLEDGE.md, measurements dated
// 2026-08 to 2026-11); the section is named beside each one. Model ids and provider
// behaviour are dated observations: re-measure before trusting them for long.

import type { AIProvider } from './ai_settings_storage';

/**
 * Below this a reasoning model can spend the whole budget thinking and answer nothing
 * (Groq gpt-oss-20b: empty at 64 and 150 tokens, a full sentence at 300; kit 1.3).
 */
export const MIN_REPLY_TOKENS = 300;

/**
 * Room added for a model that will think, so thinking cannot crowd out the answer. An
 * unreached ceiling is not billed (kit 1.3 rule 3). Kept well below the kit's 24,576
 * because Groq's free tier allows 8,000 tokens a minute for gpt-oss-120b (kit 1.1).
 */
export const THINKING_HEADROOM_TOKENS = 4096;

/**
 * Models that reason whatever is sent, keyed `provider:model` because a model is a fact
 * of its host: gpt-oss-120b reasons on Groq and does not on Cerebras (kit 1.3 rule 7).
 * A named set, never a pattern over the id (kit rule 4).
 */
export const ALWAYS_REASONS: ReadonlySet<string> = new Set([
    'groq:openai/gpt-oss-120b',
    'groq:openai/gpt-oss-20b',
]);

/** Gemini models that answer 400 to `thinkingBudget: 0` (measured 2026-09-21, kit 1.3). */
export const GEMINI_REFUSES_THINKING_OFF: ReadonlySet<string> = new Set([
    'gemini-2.5-pro',
    'gemini-3.1-pro-preview',
    'gemini-pro-latest',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
]);

/**
 * Gemini thinking setting for a model. Off: `thinkingBudget: 0`, omitted for the models
 * that refuse it (they think anyway). On: `-1`, the dynamic budget every Gemini model
 * accepts. Unknown ids are treated as able to switch off: a refusal is a loud 400 the user
 * reports, while thinking left on silently empties short replies (kit 1.3 rule 5).
 */
export function geminiThinkingConfig(model: string, thinking: boolean): { thinkingBudget: number } | null {
    if (thinking) return { thinkingBudget: -1 };
    return GEMINI_REFUSES_THINKING_OFF.has(model.trim()) ? null : { thinkingBudget: 0 };
}

/** True when this model will think even though we asked it not to. */
export function thinksAnyway(provider: AIProvider, model: string): boolean {
    const id = model.trim();
    if (ALWAYS_REASONS.has(`${provider}:${id}`)) return true;
    return provider === 'gemini' && GEMINI_REFUSES_THINKING_OFF.has(id);
}

/** Reply budget: at least the floor, plus headroom when the model is going to think. */
export function replyBudget(provider: AIProvider, model: string, requested: number, thinking = false): number {
    const base = Math.max(requested, MIN_REPLY_TOKENS);
    return thinking || thinksAnyway(provider, model) ? base + THINKING_HEADROOM_TOKENS : base;
}

/**
 * The OpenAI-shaped body for one provider. OpenAI's newer models refuse `max_tokens` and
 * any temperature but the default, both with a 400 (measured 2026-08-28 and 2026-10-15);
 * older ones accept `max_completion_tokens` too, so OpenAI always gets the new name and no
 * temperature, with no model-name test (kit 1.2). Every other host keeps `max_tokens`.
 * Only fields every host accepts: strict hosts refuse one unknown field (kit rule 1).
 */
export function openAIBody(
    provider: AIProvider, model: string, messages: unknown[], maxTokens: number, extra: Record<string, unknown> = {},
): Record<string, unknown> {
    if (provider === 'openai') return { model, messages, max_completion_tokens: maxTokens, ...extra };
    return { model, messages, temperature: 0.2, max_tokens: maxTokens, ...extra };
}

// ─── An answer that is empty is not a success (kit rule 2) ──────────────────

export const EMPTY_REPLY_MESSAGE =
    'The model used its whole reply budget thinking and wrote no answer. Choose a model that does not reason, or a larger one, in Provider Settings.';

/** Thrown when a 200 carries no answer because the reply was cut at the budget. */
export class EmptyReplyError extends Error {
    constructor() { super(EMPTY_REPLY_MESSAGE); this.name = 'EmptyReplyError'; }
}

/** Was this reply cut at the token ceiling? Reads all three response shapes. */
export function wasCutAtBudget(data: unknown): boolean {
    const d = data as {
        choices?: Array<{ finish_reason?: string }>;
        stop_reason?: string;
        candidates?: Array<{ finishReason?: string }>;
    };
    return d?.choices?.[0]?.finish_reason === 'length'
        || d?.stop_reason === 'max_tokens'
        || d?.candidates?.[0]?.finishReason === 'MAX_TOKENS';
}

// ─── Errors that point at the right cause (kit 1.4 rule 3, kit 1.6) ─────────

/** Body codes that mean "out of credit", even on a 429 (OpenAI, Moonshot, Zhipu). */
const QUOTA_CODES = ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached', 'billing_not_active', 'exceeded_current_quota_error'];

/** Does this error body say the account has no credit? Reads the body only to classify it. */
export function isOutOfCredit(status: number, body: string): boolean {
    if (status === 402) return true;
    if (QUOTA_CODES.some(c => body.includes(c))) return true;
    return /insufficient[_ ]quota|credit balance|no credits remaining|insufficient balance|no resource package|please recharge/i.test(body);
}

export const OUT_OF_CREDIT_MESSAGE = 'Out of credit with your AI provider. Add credits or check your plan; retrying will not help.';

/**
 * The error a failed provider call throws. Out of credit is named before anything else,
 * because a 429 that means "no credit" sent people to wait instead of to billing. xAI
 * answers a bad key with 400 and an unfunded team with 403 (measured 2026-08-28). The
 * provider's body is kept short: it can quote the request back.
 */
export function providerError(provider: AIProvider, status: number, body: string): Error {
    if (isOutOfCredit(status, body)) return new Error(OUT_OF_CREDIT_MESSAGE);
    if (provider === 'xai' && status === 400 && /api key/i.test(body)) return new Error('API error 401: invalid API key');
    if (provider === 'xai' && status === 403) {
        return new Error('Access denied by xAI. On xAI this usually means a team with no credits or licences, so check billing first.');
    }
    return new Error(`API error ${status}: ${body.slice(0, 300)}`);
}

// ─── Retry only what can succeed next time (kit 1.4) ────────────────────────

const RETRY_STATUS = (s: number) => s === 429 || s >= 500;
const MAX_RETRY_WAIT_MS = 10_000;

/** Seconds or an HTTP date, clamped so a hostile value cannot stall us (kit 1.4 rule 4). */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
    if (!header) return null;
    const secs = Number(header);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now;
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.min(ms, MAX_RETRY_WAIT_MS);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        const onAbort = () => { clearTimeout(t); reject(signal!.reason); };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export interface RetryOptions {
    /** The caller's own signal (Stop, batch abort). Never retried. */
    signal?: AbortSignal;
    /** Per-attempt timeout. A timeout is our own decision to stop waiting, so it is not retried either. */
    timeoutMs: number;
    /** Extra attempts after the first. */
    retries?: number;
    /** Tests pass 0. */
    baseDelayMs?: number;
}

/**
 * fetch with retries for 429 (unless it means out of credit), 5xx and network errors.
 * Every other 4xx fails the same way twice (bad key, retired model, malformed body), and
 * an abort or timeout is never retried (kit 1.4 rules 1 and 2). Returns the last response;
 * the caller reads it.
 */
export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions): Promise<Response> {
    const retries = opts.retries ?? 2;
    const base = opts.baseDelayMs ?? 1000;
    for (let attempt = 0; ; attempt++) {
        const t = AbortSignal.timeout(opts.timeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, t]) : t;
        let resp: Response;
        try {
            resp = await fetch(url, { ...init, signal });
        } catch (err) {
            const name = (err as { name?: string })?.name;
            if (name === 'AbortError' || name === 'TimeoutError' || opts.signal?.aborted || attempt >= retries) throw err;
            await wait(base * 2 ** attempt, opts.signal);
            continue;
        }
        if (resp.ok || !RETRY_STATUS(resp.status) || attempt >= retries) return resp;
        if (resp.status === 429) {
            const body = await resp.clone().text().catch(() => '');
            if (isOutOfCredit(429, body)) return resp;
        }
        await wait(retryAfterMs(resp.headers.get('retry-after')) ?? base * 2 ** attempt, opts.signal);
    }
}

// ─── Default models and retired ids (kit 1.7, ladders as of 2026-11-10) ─────

/**
 * Old shipped defaults that stopped working, mapped to the measured replacement. Applied
 * on read only when the stored id is exactly the retired one, so a model the user chose
 * deliberately is never changed. Groq retired llama-3.3-70b-versatile; DeepSeek's
 * deepseek-chat stopped resolving 2026-07-24; gemini-2.5-flash is 404 for keys from newer
 * Google projects (2026-10-07); Cerebras moved to gpt-oss-120b.
 */
export const RETIRED_MODELS: Partial<Record<AIProvider, Record<string, string>>> = {
    gemini: {
        'gemini-pro': 'gemini-3.1-flash-lite',
        'gemini-1.5-flash': 'gemini-3.1-flash-lite',
        'gemini-2.0-flash': 'gemini-3.1-flash-lite',
        'gemini-2.5-flash': 'gemini-3.1-flash-lite',
    },
    groq: { 'llama-3.3-70b-versatile': 'openai/gpt-oss-120b' },
    deepseek: { 'deepseek-chat': 'deepseek-v4-flash' },
    cerebras: { 'llama3.3-70b': 'gpt-oss-120b' },
};

export function upgradeRetiredModel(provider: AIProvider, model: string): string {
    return RETIRED_MODELS[provider]?.[model.trim()] ?? model.trim();
}

// ─── Where a key may be sent in clear text (security review 2026-11-10, F9) ─

const PRIVATE_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[\w-]+\.local|[\w-]+)$/i;

/**
 * A server the user typed (Ollama, custom) must use https unless it is on this computer or
 * the local network (localhost, private addresses, *.local, a bare host name). Plain http to
 * the internet would send the key and every title and link in clear text. Returns a reason
 * to show, or '' when the address is fine.
 */
export function endpointProblem(raw: string | undefined): string {
    let u: URL;
    try { u = new URL((raw ?? '').trim()); } catch { return 'The server address is not a valid URL. Check it in Provider Settings.'; }
    if (u.username || u.password) return 'Remove the user name and password from the server address.';
    if (u.protocol === 'https:') return '';
    if (u.protocol === 'http:' && PRIVATE_HOST.test(u.hostname)) return '';
    if (u.protocol === 'http:') return 'Use https for a server outside your computer or local network, so your key and bookmarks are not sent in clear text.';
    return 'The server address must start with https:// (or http:// on your own network).';
}
