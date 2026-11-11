// SPDX-License-Identifier: AGPL-3.0-only
// Usage statistics (D27): only safe values leave, the off switch holds, events go to our relay.
import { describe, it, expect, vi, afterEach } from 'vitest';

const real = await vi.importActual<typeof import('../src/lib/analytics')>('../src/lib/analytics');

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('usage statistics', () => {
    it('keeps numbers, booleans and short words only', () => {
        expect(real.safeParams({ provider: 'groq', on: true, n: 3.14159, title: 'My bank', url: 'https://x.example/a', 'Bad Key': 1, nan: NaN }))
            .toEqual({ provider: 'groq', on: true, n: 3.14 });
        expect(real.bucket(0)).toBe('0');
        expect(real.bucket(7)).toBe('2-10');
        expect(real.bucket(5000)).toBe('1000+');
    });

    it('maps feature messages to events, never their content', () => {
        expect(real.eventForMessage({ type: 'BATCH_CAPTURE', urls: ['https://a.example', 'https://b.example'] })).toEqual({ name: 'preview_batch', params: { count: '2-10' } });
        expect(real.eventForMessage({ type: 'AGENT_TOOL', name: 'apply_changes' })).toEqual({ name: 'ask_ai_tool', params: { tool: 'apply_changes' } });
        expect(real.eventForMessage({ type: 'META_PATCH' })).toBeNull();
    });

    it('sends a batch to our relay with an install id; nothing once turned off', async () => {
        vi.useFakeTimers();
        const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', f);
        await real.setUsageStats(true);
        real.track('app_open', { surface: 'page' });
        await vi.advanceTimersByTimeAsync(2500);
        expect(f).toHaveBeenCalledTimes(1);
        expect(f.mock.calls[0][0]).toBe(real.ANALYTICS_ENDPOINT);
        const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
        expect(body.cid).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.events[0]).toMatchObject({ n: 'app_open', p: { surface: 'page' } });

        await real.setUsageStats(false);
        expect(await real.usageStatsEnabled()).toBe(false);
        real.track('app_open');
        await vi.advanceTimersByTimeAsync(2500);
        expect(f).toHaveBeenCalledTimes(1);
        await real.setUsageStats(true);
    });

    it('marks a development copy and sends nothing from incognito', async () => {
        vi.useFakeTimers();
        const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', f);
        real.track('app_open');
        await vi.advanceTimersByTimeAsync(2500);
        expect(f).toHaveBeenCalledTimes(1);
        expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).dev).toBe(true);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).chrome.extension.inIncognitoContext = true;
        real.track('app_open');
        await vi.advanceTimersByTimeAsync(2500);
        expect(f).toHaveBeenCalledTimes(1);
    });
});
