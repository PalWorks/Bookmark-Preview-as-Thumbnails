// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any */
// The in-product feedback module (1.6.0): validation, the opt-in diagnostics
// payload, and the submit path's error handling. Ported from Gmail Labels as Tabs.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    FEEDBACK_CATEGORIES,
    MAX_MESSAGE_CHARS,
    buildDiagnostics,
    buildFeedbackPayload,
    isPlausibleEmail,
    submitFeedback,
    validateFeedback,
} from '../src/lib/feedback';

const ENDPOINT = 'https://relay.test/feedback';
const realFetch = globalThis.fetch;
const realManifest = (globalThis as any).chrome.runtime.getManifest;

beforeEach(() => {
    (globalThis as any).chrome.runtime.getManifest = () => ({ version: '1.6.0' });
    Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
        configurable: true,
    });
});

afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as any).chrome.runtime.getManifest = realManifest;
    vi.restoreAllMocks();
});

// ------ validation ------

describe('validateFeedback', () => {
    it('rejects a message that says nothing', () => {
        expect(validateFeedback({ message: '  hi ' })).toMatch(/write a little more/i);
    });

    it('rejects a message beyond the cap', () => {
        expect(validateFeedback({ message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) })).toMatch(/under 4000/);
    });

    it('rejects a malformed reply address', () => {
        expect(validateFeedback({ message: 'The bar vanished', replyTo: 'not-an-email' })).toMatch(/does not look right/);
    });

    it('accepts a real message with no address', () => {
        expect(validateFeedback({ message: 'The tab bar vanished after an update.' })).toBeNull();
    });

    it('accepts a real message with an address', () => {
        expect(validateFeedback({ message: 'Please add keyboard shortcuts.', replyTo: 'a@b.co' })).toBeNull();
    });
});

describe('isPlausibleEmail', () => {
    it.each([
        ['user@example.com', true],
        ['user.name+tag@sub.example.co.uk', true],
        ['user@localhost', false],
        ['no-at-sign.com', false],
        ['two@@example.com', false],
    ])('%s -> %s', (value, expected) => {
        expect(isPlausibleEmail(value as string)).toBe(expected);
    });
});

// ------ payload ------

describe('buildFeedbackPayload', () => {
    it('trims input and always carries an empty honeypot', () => {
        const payload = buildFeedbackPayload({
            category: 'bug',
            message: '  spacing is off  ',
            replyTo: '  a@b.co ',
        });

        expect(payload.message).toBe('spacing is off');
        expect(payload.replyTo).toBe('a@b.co');
        expect(payload.website).toBe('');
    });

    it('omits an empty reply address rather than sending a blank', () => {
        const payload = buildFeedbackPayload({ category: 'other', message: 'a message', replyTo: '   ' });
        expect(payload).not.toHaveProperty('replyTo');
    });

    it('every category in the union is accepted', () => {
        for (const category of FEEDBACK_CATEGORIES) {
            expect(buildFeedbackPayload({ category, message: 'a message' }).category).toBe(category);
        }
    });
});

describe('buildDiagnostics', () => {
    it('reports version, browser and counts only', () => {
        const d = buildDiagnostics({ bookmarks: 794, folders: 12, view: 'grid' });

        expect(d).toEqual({
            version: '1.6.0',
            browser: 'Chrome/153.0.0.0 on Linux',
            bookmarks: 794,
            folders: 12,
            view: 'grid',
        });
        // Nothing identifying may ever appear in this object.
        expect(JSON.stringify(d)).not.toMatch(/@/);
    });

    it('survives a missing manifest (non-extension context)', () => {
        (globalThis as any).chrome.runtime.getManifest = () => { throw new Error('no manifest'); };
        expect(buildDiagnostics({ bookmarks: 0, folders: 0, view: 'list' }).version).toBe('unknown');
    });
});

// ------ submit ------

describe('submitFeedback', () => {
    it('posts JSON to the relay and reports success', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        (globalThis as any).fetch = fetchMock;

        const result = await submitFeedback({ category: 'bug', message: 'The bar vanished.' }, ENDPOINT);

        expect(result).toEqual({ ok: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(ENDPOINT);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body).message).toBe('The bar vanished.');
    });

    it('never sends an invalid message', async () => {
        const fetchMock = vi.fn();
        (globalThis as any).fetch = fetchMock;

        const result = await submitFeedback({ category: 'bug', message: 'no' }, ENDPOINT);

        expect(result.ok).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains a rate limit in the user\'s terms', async () => {
        (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });

        const result = await submitFeedback({ category: 'other', message: 'a real message' }, ENDPOINT);

        expect(result).toEqual({ ok: false, error: expect.stringMatching(/too many messages/i) });
    });

    it('surfaces the relay\'s error message when it sends one', async () => {
        (globalThis as any).fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ error: 'Message is too short' }),
        });

        const result = await submitFeedback({ category: 'other', message: 'a real message' }, ENDPOINT);

        expect(result).toEqual({ ok: false, error: 'Message is too short' });
    });

    it('reports a network failure instead of throwing', async () => {
        (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

        const result = await submitFeedback({ category: 'other', message: 'a real message' }, ENDPOINT);

        expect(result).toEqual({ ok: false, error: expect.stringMatching(/no connection/i) });
    });

    it('reports a timeout distinctly from a network failure', async () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        (globalThis as any).fetch = vi.fn().mockRejectedValue(abortError);

        const result = await submitFeedback({ category: 'other', message: 'a real message' }, ENDPOINT);

        expect(result).toEqual({ ok: false, error: expect.stringMatching(/took too long/i) });
    });
});

describe('browser build in diagnostics (review of PR #11)', () => {
    it('reports Edge as Edge, not Chrome', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0',
            configurable: true,
        });
        expect(buildDiagnostics({ bookmarks: 1, folders: 1, view: 'grid' }).browser).toBe('Edg/156.0.0.0 on Windows');
    });
});

describe('submitFeedback timeouts and odd replies (review of PR #11)', () => {
    it('gives up after 12 seconds with a clear message', async () => {
        vi.useFakeTimers();
        try {
            (globalThis as any).fetch = vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => {
                init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            }));
            const pending = submitFeedback({ category: 'bug', message: 'A real message here.' }, ENDPOINT);
            await vi.advanceTimersByTimeAsync(12000);
            expect(await pending).toEqual({ ok: false, error: expect.stringMatching(/took too long/i) });
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back to a generic message when the error reply is not JSON', async () => {
        (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError('x')) });
        expect(await submitFeedback({ category: 'bug', message: 'A real message here.' }, ENDPOINT))
            .toEqual({ ok: false, error: 'Could not send right now. Please try again later.' });
    });
});
