// SPDX-License-Identifier: AGPL-3.0-only
// Provider rules ported from ai-provider-kit: request shape, budgets, empty replies,
// out-of-credit errors, retries, retired defaults, OpenRouter key check.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    openAIBody, replyBudget, geminiThinkingConfig, isOutOfCredit, providerError, wasCutAtBudget,
    retryAfterMs, fetchWithRetry, upgradeRetiredModel, MIN_REPLY_TOKENS, THINKING_HEADROOM_TOKENS,
    OUT_OF_CREDIT_MESSAGE, EMPTY_REPLY_MESSAGE,
} from '../src/lib/ai_provider_rules';
import { friendlyError, isFatalAIError, validateProviderKey } from '../src/lib/ai_tagger';
import { callModel } from '../src/lib/agent/llm';

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(
    typeof body === 'string' ? body : JSON.stringify(body), { status, headers },
);

afterEach(() => vi.unstubAllGlobals());

describe('request shape', () => {
    it('OpenAI gets max_completion_tokens and no temperature; other hosts keep max_tokens', () => {
        const o = openAIBody('openai', 'gpt-5.4-nano', [], 300);
        expect(o).toEqual({ model: 'gpt-5.4-nano', messages: [], max_completion_tokens: 300 });
        const g = openAIBody('groq', 'm', [], 300, { tools: [] });
        expect(g).toEqual({ model: 'm', messages: [], temperature: 0.2, max_tokens: 300, tools: [] });
    });

    it('budget has a floor and headroom for models that think anyway', () => {
        expect(replyBudget('openai', 'gpt-4o-mini', 64)).toBe(MIN_REPLY_TOKENS);
        expect(replyBudget('groq', 'openai/gpt-oss-120b', 256)).toBe(MIN_REPLY_TOKENS + THINKING_HEADROOM_TOKENS);
        expect(replyBudget('cerebras', 'gpt-oss-120b', 256)).toBe(MIN_REPLY_TOKENS);
        expect(replyBudget('gemini', 'gemini-2.5-pro', 256)).toBe(MIN_REPLY_TOKENS + THINKING_HEADROOM_TOKENS);
        expect(replyBudget('gemini', 'gemini-3.1-flash-lite', 4096, true)).toBe(4096 + THINKING_HEADROOM_TOKENS);
    });

    it('Gemini thinking is switched off by named set, not by a pattern over the id', () => {
        expect(geminiThinkingConfig('gemini-3.8-flash', false)).toEqual({ thinkingBudget: 0 });
        expect(geminiThinkingConfig('gemini-2.5-pro', false)).toBeNull();
        expect(geminiThinkingConfig('gemini-2.5-pro', true)).toEqual({ thinkingBudget: -1 });
    });
});

describe('errors', () => {
    it('a 429 that means no credit is named as such, before rate limits', () => {
        expect(isOutOfCredit(429, '{"error":{"code":"insufficient_quota"}}')).toBe(true);
        expect(isOutOfCredit(429, '{"error":"slow down"}')).toBe(false);
        expect(isOutOfCredit(402, '')).toBe(true);
        const e = providerError('openai', 429, '{"error":{"code":"insufficient_quota"}}');
        expect(e.message).toBe(OUT_OF_CREDIT_MESSAGE);
        expect(friendlyError(e)).toBe(OUT_OF_CREDIT_MESSAGE);
        expect(isFatalAIError(friendlyError(e))).toBe(true);
        expect(friendlyError(providerError('groq', 429, 'rate limit'))).toMatch(/Rate limited/);
    });

    it('xAI: a bad key is 400 and an unfunded team is 403', () => {
        expect(friendlyError(providerError('xai', 400, 'Incorrect API key provided'))).toMatch(/Invalid or missing API key/);
        const team = friendlyError(providerError('xai', 403, 'no credits'));
        expect(team).toMatch(/xAI/);
        expect(isFatalAIError(team)).toBe(true);
    });

    it('an empty reply cut at the budget is detected in all three shapes, and stops a batch', () => {
        expect(wasCutAtBudget({ choices: [{ finish_reason: 'length' }] })).toBe(true);
        expect(wasCutAtBudget({ stop_reason: 'max_tokens' })).toBe(true);
        expect(wasCutAtBudget({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toBe(true);
        expect(wasCutAtBudget({ choices: [{ finish_reason: 'stop' }] })).toBe(false);
        expect(isFatalAIError(friendlyError(new Error(EMPTY_REPLY_MESSAGE)))).toBe(true);
    });
});

describe('fetchWithRetry', () => {
    it('retries 5xx, then returns the success', async () => {
        const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, { ok: 1 }));
        vi.stubGlobal('fetch', f);
        const r = await fetchWithRetry('https://x', {}, { timeoutMs: 1000, baseDelayMs: 0 });
        expect(r.status).toBe(200);
        expect(f).toHaveBeenCalledTimes(2);
    });

    it('never retries a 401 or an out-of-credit 429', async () => {
        const f = vi.fn().mockResolvedValue(res(401));
        vi.stubGlobal('fetch', f);
        expect((await fetchWithRetry('https://x', {}, { timeoutMs: 1000, baseDelayMs: 0 })).status).toBe(401);
        expect(f).toHaveBeenCalledTimes(1);
        const q = vi.fn().mockImplementation(async () => res(429, { error: { code: 'insufficient_quota' } }));
        vi.stubGlobal('fetch', q);
        expect((await fetchWithRetry('https://x', {}, { timeoutMs: 1000, baseDelayMs: 0 })).status).toBe(429);
        expect(q).toHaveBeenCalledTimes(1);
    });

    it('never retries our own abort', async () => {
        const f = vi.fn().mockRejectedValue(new DOMException('stopped', 'AbortError'));
        vi.stubGlobal('fetch', f);
        await expect(fetchWithRetry('https://x', {}, { timeoutMs: 1000, baseDelayMs: 0 })).rejects.toThrow();
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('reads Retry-After in both forms and clamps it', () => {
        expect(retryAfterMs('2')).toBe(2000);
        expect(retryAfterMs('3600')).toBe(10_000);
        expect(retryAfterMs(new Date(5_000).toUTCString(), 0)).toBe(5000);
        expect(retryAfterMs('soon')).toBeNull();
    });
});

describe('retired defaults', () => {
    it('upgrades only the exact retired id', () => {
        expect(upgradeRetiredModel('groq', 'llama-3.3-70b-versatile')).toBe('openai/gpt-oss-120b');
        expect(upgradeRetiredModel('deepseek', 'deepseek-chat')).toBe('deepseek-v4-flash');
        expect(upgradeRetiredModel('groq', 'llama-3.1-8b-instant')).toBe('llama-3.1-8b-instant');
        expect(upgradeRetiredModel('openai', 'deepseek-chat')).toBe('deepseek-chat');
    });
});

describe('OpenRouter key check', () => {
    it('asks /key, not the public /models catalogue, and refuses a management key', async () => {
        const f = vi.fn().mockResolvedValue(res(200, { data: { label: 'x' } }));
        vi.stubGlobal('fetch', f);
        const ok = await validateProviderKey('openrouter', 'sk-or-1', '');
        expect(ok).toMatchObject({ ok: true, message: 'Key accepted.' });
        expect(f.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)));
        expect((await validateProviderKey('openrouter', 'bogus', '')).ok).toBe(false);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { data: { is_management_key: true } })));
        expect(await validateProviderKey('openrouter', 'mgmt', '')).toMatchObject({ ok: false, message: expect.stringMatching(/management key/) });
    });
});

describe('Ask AI requests', () => {
    it('OpenAI: new budget field, no temperature; an empty cut reply is an error', async () => {
        const f = vi.fn().mockResolvedValue(res(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] }));
        vi.stubGlobal('fetch', f);
        await expect(callModel({ provider: 'openai', model: 'gpt-5.4-nano' }, 'k', [{ role: 'user', text: 'hi' }])).rejects.toThrow(EMPTY_REPLY_MESSAGE);
        const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
        expect(body.max_completion_tokens).toBeGreaterThan(0);
        expect(body).not.toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('temperature');
    });
});
