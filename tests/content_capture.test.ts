// SPDX-License-Identifier: AGPL-3.0-only
// The content script's capture (1.6.0): html2canvas-pro, page scripts left out of
// the copy, and an expected failure logged as a warning, not an error.
import { describe, it, expect, vi, beforeAll } from 'vitest';

const h2c = vi.hoisted(() => vi.fn());
vi.mock('html2canvas-pro', () => ({ default: h2c }));

type Listener = (req: unknown, sender: unknown, send: (r: unknown) => void) => boolean | undefined;
let listener: Listener;

beforeAll(async () => {
    const add = vi.spyOn(chrome.runtime.onMessage, 'addListener');
    await import('../src/content/capture');
    listener = add.mock.calls.at(-1)![0] as unknown as Listener;
});

const capture = () => new Promise<{ success: boolean; error?: string }>((resolve) => {
    listener({ action: 'CAPTURE_TAB' }, {}, resolve as (r: unknown) => void);
});

describe('content script capture', () => {
    it('leaves script and noscript elements out of the page copy', async () => {
        h2c.mockResolvedValueOnce({ toDataURL: () => 'data:image/webp;base64,AAAA' });
        expect((await capture()).success).toBe(true);
        const options = h2c.mock.calls[0][1] as { ignoreElements: (el: Element) => boolean };
        expect(options.ignoreElements(document.createElement('script'))).toBe(true);
        expect(options.ignoreElements(document.createElement('noscript'))).toBe(true);
        expect(options.ignoreElements(document.createElement('div'))).toBe(false);
    });

    it('reports a failure and logs it as a warning, not an error', async () => {
        h2c.mockRejectedValueOnce(new Error('Attempting to parse an unsupported color function "color"'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const error = vi.spyOn(console, 'error');
        const res = await capture();
        expect(res).toEqual({ success: false, error: expect.stringMatching(/unsupported color/) });
        expect(warn).toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});
