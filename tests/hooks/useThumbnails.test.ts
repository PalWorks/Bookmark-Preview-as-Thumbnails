/**
 * Hook tests for useThumbnails.
 *
 * Tests the core contract: folder-change loading, message handling,
 * manual capture triggering, and cancellation behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThumbnails } from '../../src/popup/hooks/useThumbnails';
import { thumbnailStorage } from '../../src/lib/thumbnail_storage';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Capture the runtime message listeners registered by the hook
let messageListeners: Array<(message: Record<string, unknown>) => void> = [];

beforeEach(() => {
    messageListeners = [];

    // Wire chrome.runtime.onMessage so the hook can register listeners
    (chrome.runtime.onMessage.addListener as any).mockImplementation(
        (fn: (msg: Record<string, unknown>) => void) => {
            messageListeners.push(fn);
        }
    );
    (chrome.runtime.onMessage.removeListener as any).mockImplementation(
        (fn: (msg: Record<string, unknown>) => void) => {
            messageListeners = messageListeners.filter(l => l !== fn);
        }
    );

    // Default sendMessage mock (no-op)
    (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
});

/* eslint-enable @typescript-eslint/no-explicit-any */

function makeFolder(children: Array<{ id: string; url?: string; title: string }>): chrome.bookmarks.BookmarkTreeNode {
    return {
        id: 'folder-1',
        title: 'Test Folder',
        children: children.map(c => ({
            ...c,
            title: c.title,
            parentId: 'folder-1',
            index: 0,
        })) as chrome.bookmarks.BookmarkTreeNode[],
    };
}

function broadcast(message: Record<string, unknown>) {
    messageListeners.forEach(l => l(message));
}

describe('useThumbnails', () => {
    it('returns empty state on mount with null folder', () => {
        const { result } = renderHook(() => useThumbnails(null, false));

        expect(result.current.thumbnails).toEqual({});
        expect(result.current.loadingUrls.size).toBe(0);
        expect(result.current.queuedUrls.size).toBe(0);
    });

    it('does not auto-capture on folder load', async () => {
        const folder = makeFolder([
            { id: 'b1', url: 'https://example.com', title: 'Example' },
            { id: 'b2', url: 'https://test.com', title: 'Test' },
        ]);

        renderHook(() => useThumbnails(folder, false));

        // Allow effect to settle
        await new Promise(r => setTimeout(r, 100));

        // sendMessage should NOT have been called with BATCH_CAPTURE
        const calls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        const batchCalls = calls.filter(
            (c: unknown[]) => (c[0] as Record<string, unknown>)?.type === 'BATCH_CAPTURE'
        );
        expect(batchCalls).toHaveLength(0);
    });

    it('triggerCapture sends BATCH_CAPTURE message', () => {
        const { result } = renderHook(() => useThumbnails(null, false));

        act(() => {
            result.current.triggerCapture(['https://example.com', 'https://test.com']);
        });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'BATCH_CAPTURE',
                urls: ['https://example.com', 'https://test.com'],
            })
        );
    });

    it('BATCH_STOPPED message clears loading and queued sets', () => {
        const { result } = renderHook(() => useThumbnails(null, false));

        // Manually trigger capture to populate queued set
        act(() => {
            result.current.triggerCapture(['https://example.com']);
        });

        expect(result.current.queuedUrls.size).toBe(1);

        // Simulate BATCH_STOPPED from SW
        act(() => {
            broadcast({ type: 'BATCH_STOPPED' });
        });

        expect(result.current.loadingUrls.size).toBe(0);
        expect(result.current.queuedUrls.size).toBe(0);
    });

    it('CAPTURE_STARTED moves URL from queued to loading', () => {
        const { result } = renderHook(() => useThumbnails(null, false));

        // Manually trigger capture
        act(() => {
            result.current.triggerCapture(['https://example.com']);
        });

        expect(result.current.queuedUrls.has('https://example.com')).toBe(true);

        // Simulate CAPTURE_STARTED
        act(() => {
            broadcast({ type: 'CAPTURE_STARTED', url: 'https://example.com' });
        });

        expect(result.current.loadingUrls.has('https://example.com')).toBe(true);
        expect(result.current.queuedUrls.has('https://example.com')).toBe(false);
    });

    it('CAPTURE_FAILED removes URL from loading', () => {
        const { result } = renderHook(() => useThumbnails(null, false));

        // Put URL into loading state
        act(() => {
            result.current.triggerCapture(['https://example.com']);
        });
        act(() => {
            broadcast({ type: 'CAPTURE_STARTED', url: 'https://example.com' });
        });

        expect(result.current.loadingUrls.has('https://example.com')).toBe(true);

        // Simulate failure
        act(() => {
            broadcast({ type: 'CAPTURE_FAILED', url: 'https://example.com' });
        });

        expect(result.current.loadingUrls.has('https://example.com')).toBe(false);
    });

    it('CAPTURE_FAILED clears a URL still in queued (skipped before CAPTURE_STARTED)', () => {
        // Reproduces the unsupported-scheme leak: the SW skips a chrome:// URL and
        // emits CAPTURE_FAILED without a preceding CAPTURE_STARTED, so the URL is
        // still in queuedUrls and must be cleared from there.
        const { result } = renderHook(() => useThumbnails(null, false));

        act(() => {
            result.current.triggerCapture(['chrome://settings']);
        });
        expect(result.current.queuedUrls.has('chrome://settings')).toBe(true);

        act(() => {
            broadcast({ type: 'CAPTURE_FAILED', url: 'chrome://settings' });
        });

        expect(result.current.queuedUrls.has('chrome://settings')).toBe(false);
        expect(result.current.loadingUrls.has('chrome://settings')).toBe(false);
    });

    it('releases queued URLs when the SW responds busy', async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'busy' });
        const { result } = renderHook(() => useThumbnails(null, false));

        await act(async () => {
            result.current.triggerCapture(['https://example.com']);
        });

        await waitFor(() => expect(result.current.queuedUrls.size).toBe(0));
    });

    it('releases queued URLs when sendMessage rejects (SW unavailable)', async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Could not establish connection')
        );
        const { result } = renderHook(() => useThumbnails(null, false));

        await act(async () => {
            result.current.triggerCapture(['https://example.com']);
        });

        await waitFor(() => expect(result.current.queuedUrls.size).toBe(0));
    });

    it('stopCapture sends STOP_CAPTURE message', () => {
        const { result } = renderHook(() => useThumbnails(null, false));

        act(() => {
            result.current.stopCapture();
        });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'STOP_CAPTURE' });
    });

    it('THUMBNAIL_UPDATED applies only the latest read per URL (no stale clobber)', async () => {
        const url = 'https://example.com';
        const olderBlob = new Blob(['old'], { type: 'image/webp' });
        const newerBlob = new Blob(['new'], { type: 'image/webp' });

        let resolveOlder!: (v: unknown) => void;
        let resolveNewer!: (v: unknown) => void;
        const olderP = new Promise(r => { resolveOlder = r; });
        const newerP = new Promise(r => { resolveNewer = r; });

        const getSpy = vi.spyOn(thumbnailStorage, 'getThumbnail')
            .mockReturnValueOnce(olderP as ReturnType<typeof thumbnailStorage.getThumbnail>)
            .mockReturnValueOnce(newerP as ReturnType<typeof thumbnailStorage.getThumbnail>);

        const origCreate = URL.createObjectURL;
        const origRevoke = URL.revokeObjectURL;
        const createSpy = vi.fn((b: Blob) => `blob:${(b as Blob).size}`);
        URL.createObjectURL = createSpy as typeof URL.createObjectURL;
        URL.revokeObjectURL = vi.fn();

        try {
            renderHook(() => useThumbnails(null, false));

            // Two updates for the same URL fire two parallel reads (seq 1 then 2).
            act(() => {
                broadcast({ type: 'THUMBNAIL_UPDATED', url });
                broadcast({ type: 'THUMBNAIL_UPDATED', url });
            });

            // Resolve the NEWER read first, then the older one resolves late.
            await act(async () => {
                resolveNewer({ blob: newerBlob });
                resolveOlder({ blob: olderBlob });
                await Promise.resolve();
            });

            // The stale (older) read must be ignored: only the newer blob is applied.
            expect(createSpy).toHaveBeenCalledTimes(1);
            expect(createSpy).toHaveBeenCalledWith(newerBlob);
        } finally {
            getSpy.mockRestore();
            URL.createObjectURL = origCreate;
            URL.revokeObjectURL = origRevoke;
        }
    });

    it('cleans up message listener on unmount', () => {
        const { unmount } = renderHook(() => useThumbnails(null, false));

        expect(messageListeners.length).toBe(1);

        unmount();

        expect(messageListeners.length).toBe(0);
    });
});
