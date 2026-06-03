import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseTags, checkAIAvailability, AI_TAGS, friendlyError, isFatalAIError, searchBookmarks } from '../src/lib/ai_tagger';

// ─── searchBookmarks: literal keyword matching ────────────────────────────────
// With no real model available in the test env, the AI call rejects — exercising
// the guarantee that literal keyword matches still surface (graceful degradation).

describe('searchBookmarks literal matching', () => {
    it('returns literal keyword matches even when the model is unavailable', async () => {
        const bms = [
            { title: 'South Indian Recipes', url: 'https://food.example/south-indian' },
            { title: 'Pizza Night', url: 'https://food.example/pizza' },
        ];
        const urls = await searchBookmarks('south indian', bms);
        expect(urls).toContain('https://food.example/south-indian');
        expect(urls).not.toContain('https://food.example/pizza');
    });

    it('matches all query words across boundaries (title or URL, hyphenated)', async () => {
        const bms = [{ title: 'Recipes', url: 'https://x.example/south-indian-food' }];
        const urls = await searchBookmarks('south indian', bms);
        expect(urls).toEqual(['https://x.example/south-indian-food']);
    });

    it('returns empty for a blank query or empty list', async () => {
        expect(await searchBookmarks('   ', [{ title: 'a', url: 'https://a' }])).toEqual([]);
        expect(await searchBookmarks('x', [])).toEqual([]);
    });
});

// ─── friendlyError + isFatalAIError ───────────────────────────────────────────

describe('friendlyError', () => {
    it('maps a 404 / "no longer available" to a model-not-found hint', () => {
        const msg = friendlyError(new Error('Gemini error 404: model gemini-2.0-flash is no longer available'));
        expect(msg).toMatch(/model not found/i);
    });

    it('maps 401 / invalid key to an API-key hint', () => {
        expect(friendlyError(new Error('API error 401: invalid api key'))).toMatch(/api key/i);
    });

    it('maps a fetch failure to a network hint', () => {
        expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/network|unreachable/i);
    });

    it('reports aborts as cancelled', () => {
        expect(friendlyError(new DOMException('x', 'AbortError'))).toMatch(/cancel/i);
    });
});

describe('isFatalAIError', () => {
    it('treats config errors (bad key, wrong model, quota) as fatal — abort the batch', () => {
        expect(isFatalAIError('Invalid or missing API key — check Provider Settings.')).toBe(true);
        expect(isFatalAIError('Model not found — update the model name in Provider Settings.')).toBe(true);
        expect(isFatalAIError('Quota or billing issue with your provider account.')).toBe(true);
    });

    it('treats transient errors (timeout, rate-limit, server) as non-fatal — skip and continue', () => {
        expect(isFatalAIError('AI request timed out. The model may be busy or unreachable.')).toBe(false);
        expect(isFatalAIError('Rate limited by the provider — wait a moment and retry.')).toBe(false);
        expect(isFatalAIError('Provider server error — try again shortly.')).toBe(false);
    });
});

// ─── parseTags ────────────────────────────────────────────────────────────────

describe('parseTags', () => {
    it('keeps clean comma-separated tags', () => {
        expect(parseTags('Dev, Tools')).toEqual(['Dev', 'Tools']);
    });

    it('accepts free-form tags the model invents (open vocabulary, no whitelist)', () => {
        expect(parseTags('Machine Learning, Recipes')).toEqual(['Machine Learning', 'Recipes']);
    });

    it('caps output at 3 tags', () => {
        expect(parseTags('Dev, Design, Finance, Shopping')).toHaveLength(3);
    });

    it('de-duplicates case-insensitively', () => {
        expect(parseTags('Dev, dev, DEV')).toEqual(['Dev']);
    });

    it('strips quotes and brackets from JSON-ish output', () => {
        expect(parseTags('["Dev", "News"]')).toEqual(['Dev', 'News']);
    });

    it('strips leading bullets / numbering', () => {
        expect(parseTags('1. Dev, 2. News')).toEqual(['Dev', 'News']);
    });

    it('drops empty segments and trims whitespace', () => {
        expect(parseTags('  Dev , ,  News  ')).toEqual(['Dev', 'News']);
    });

    it('returns an empty array for blank input', () => {
        expect(parseTags('   ')).toEqual([]);
    });

    it('all suggested tags pass through unchanged', () => {
        for (const tag of AI_TAGS) {
            expect(parseTags(tag)).toContain(tag);
        }
    });
});

// ─── checkAIAvailability ─────────────────────────────────────────────────────

describe('checkAIAvailability', () => {
    beforeEach(() => {
        // Ensure LanguageModel is not present in the test env (jsdom)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).LanguageModel;
    });

    it('returns "unsupported" when LanguageModel is not defined', async () => {
        const result = await checkAIAvailability();
        expect(result).toBe('unsupported');
    });

    it('returns "unsupported" when LanguageModel.availability throws', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).LanguageModel = {
            availability: vi.fn().mockRejectedValue(new Error('Not supported')),
        };
        const result = await checkAIAvailability();
        expect(result).toBe('unsupported');
    });

    it('returns the availability string from LanguageModel.availability', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).LanguageModel = {
            availability: vi.fn().mockResolvedValue('available'),
        };
        const result = await checkAIAvailability();
        expect(result).toBe('available');
    });

    it('handles "after-download" availability', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).LanguageModel = {
            availability: vi.fn().mockResolvedValue('after-download'),
        };
        const result = await checkAIAvailability();
        expect(result).toBe('after-download');
    });
});
