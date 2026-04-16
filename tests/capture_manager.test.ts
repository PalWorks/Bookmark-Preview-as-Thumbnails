import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureManager } from '../src/lib/capture';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Minimal 1×1 WebP as a data URL (content doesn't matter for routing tests)
const FAKE_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH';

// @types/chrome uses callback-style signatures (returns void), but our mock returns Promises.
// This helper casts any chrome API stub to its vi.fn() interface for assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: unknown) => fn as any as { mockResolvedValue(v: unknown): void; mockRejectedValue(v: unknown): void };

function mockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
    return {
        id: 42,
        index: 0,
        windowId: 1,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: false,
        selected: false,
        discarded: false,
        autoDiscardable: true,
        frozen: false,
        groupId: -1,
        url: 'https://example.com',
        title: 'Example',
        ...overrides,
    } as chrome.tabs.Tab;
}

function mockWindow(overrides: Partial<chrome.windows.Window> = {}): chrome.windows.Window {
    return {
        id: 1,
        focused: true,
        state: 'normal',
        alwaysOnTop: false,
        incognito: false,
        type: 'normal',
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CaptureManager', () => {
    let manager: CaptureManager;

    beforeEach(() => {
        manager = new CaptureManager();
        // Spy on the two leaf capture methods so routing tests don't need
        // real Chrome APIs or real rendering.
        vi.spyOn(manager, 'captureVisibleTab').mockResolvedValue(FAKE_DATA_URL);
        vi.spyOn(manager, 'captureBackgroundTab').mockResolvedValue(FAKE_DATA_URL);
    });

    // ── capture() routing ────────────────────────────────────────────────────

    it('routes to captureVisibleTab when tab is active, not minimized, and window is focused', async () => {
        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ active: true }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow({ state: 'normal', focused: true }));

        await manager.capture(42);

        expect(manager.captureVisibleTab).toHaveBeenCalledWith(1);
        expect(manager.captureBackgroundTab).not.toHaveBeenCalled();
    });

    it('routes to captureBackgroundTab when tab is not active', async () => {
        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ active: false }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow({ state: 'normal', focused: true }));

        await manager.capture(42);

        expect(manager.captureBackgroundTab).toHaveBeenCalledWith(42);
        expect(manager.captureVisibleTab).not.toHaveBeenCalled();
    });

    it('routes to captureBackgroundTab when window is minimized', async () => {
        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ active: true }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow({ state: 'minimized', focused: false }));

        await manager.capture(42);

        expect(manager.captureBackgroundTab).toHaveBeenCalledWith(42);
    });

    it('routes to captureBackgroundTab when window is not focused', async () => {
        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ active: true }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow({ state: 'normal', focused: false }));

        await manager.capture(42);

        expect(manager.captureBackgroundTab).toHaveBeenCalledWith(42);
    });

    it('falls back to captureBackgroundTab when captureVisibleTab throws', async () => {
        // Restore the spy and make captureVisibleTab throw
        vi.spyOn(manager, 'captureVisibleTab').mockRejectedValue(new Error('Permission denied'));
        vi.spyOn(manager, 'captureBackgroundTab').mockResolvedValue(FAKE_DATA_URL);

        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ active: true }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow({ state: 'normal', focused: true }));

        const result = await manager.capture(42);
        expect(result).toBe(FAKE_DATA_URL);
        expect(manager.captureBackgroundTab).toHaveBeenCalledWith(42);
    });

    // ── useActiveTabCapture path ─────────────────────────────────────────────

    it('useActiveTabCapture: activates the target tab before capturing', async () => {
        const originalActiveTab = mockTab({ id: 99, active: true });
        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ id: 42, active: false }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow());
        asMock(chrome.tabs.query).mockResolvedValue([originalActiveTab]);
        asMock(chrome.tabs.update).mockResolvedValue(mockTab());

        // Restore captureVisibleTab to use our mock
        vi.spyOn(manager, 'captureVisibleTab').mockResolvedValue(FAKE_DATA_URL);

        await manager.capture(42, { useActiveTabCapture: true });

        // Must activate the target tab
        expect(chrome.tabs.update).toHaveBeenCalledWith(42, { active: true });
        // Must use the visible capture path
        expect(manager.captureVisibleTab).toHaveBeenCalledWith(1);
    });

    it('useActiveTabCapture: restores the previously active tab after capture', async () => {
        const originalActiveTab = mockTab({ id: 99, active: true });
        asMock(chrome.tabs.get).mockResolvedValue(mockTab({ id: 42, active: false }));
        asMock(chrome.windows.get).mockResolvedValue(mockWindow());
        asMock(chrome.tabs.query).mockResolvedValue([originalActiveTab]);
        asMock(chrome.tabs.update).mockResolvedValue(mockTab());
        vi.spyOn(manager, 'captureVisibleTab').mockResolvedValue(FAKE_DATA_URL);

        await manager.capture(42, { useActiveTabCapture: true });

        // After capture, must restore the original active tab
        expect(chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
    });

    // ── resizeAndCompress ────────────────────────────────────────────────────

    it('resizeAndCompress() returns an object with the expected shape', async () => {
        // jsdom does not have OffscreenCanvas, so DOM path is used.
        // We verify the returned structure without relying on canvas rendering.
        const mockBlob = new Blob(['img'], { type: 'image/webp' });

        // Stub the HTMLCanvasElement and Image to avoid jsdom canvas limitations
        const mockCtx = { drawImage: vi.fn() };
        const mockCanvas = {
            getContext: vi.fn(() => mockCtx),
            toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(mockBlob)),
            toDataURL: vi.fn(() => FAKE_DATA_URL),
            width: 0,
            height: 0,
        };
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            if (tag === 'canvas') return mockCanvas as unknown as HTMLElement;
            return document.createElement(tag);
        });

        // Create an Image that fires onload immediately
        const origImage = globalThis.Image;
        // @ts-expect-error – patching global Image for test
        globalThis.Image = class {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 50;
            set src(_: string) {
                // fire onload asynchronously
                Promise.resolve().then(() => this.onload?.());
            }
        };

        const result = await manager.resizeAndCompress(FAKE_DATA_URL, 600, 0.8);

        expect(result).toHaveProperty('blob');
        expect(result).toHaveProperty('dataUrl');
        expect(result).toHaveProperty('width');
        expect(result).toHaveProperty('height');
        expect(result).toHaveProperty('sizeBytes');
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.width).toBe(600);

        // Cleanup
        globalThis.Image = origImage;
    });
});
