// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAITagger } from '../../src/popup/hooks/useAITagger';
import { localStore } from '../setup';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeFolder(
    children: Array<{ id: string; url?: string; title: string }>
): chrome.bookmarks.BookmarkTreeNode {
    return {
        id: 'f1', title: 'Test Folder', syncing: false,
        children: children.map(c => ({ ...c, dateAdded: 0, syncing: false })),
    };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('useAITagger', () => {
    beforeEach(() => {
        // CHECK_AI_AVAILABILITY → 'available' by default
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chrome.runtime.sendMessage as any).mockImplementation(
            (msg: { type: string }) => {
                if (msg.type === 'CHECK_AI_AVAILABILITY') {
                    return Promise.resolve({ available: 'available' });
                }
                return Promise.resolve({});
            }
        );
    });

    it('loads persisted tags from storageIndex on folder change', async () => {
        const url = 'https://example.com';
        localStore[`meta_${url}`] = { id: url, url, title: 'Example', status: 'none', tags: ['Dev', 'Tools'] };

        const folder = makeFolder([{ id: 'b1', url, title: 'Example' }]);
        const { result } = renderHook(() => useAITagger(folder));
        await act(async () => { await Promise.resolve(); });
        expect(result.current.tags[url]).toEqual(['Dev', 'Tools']);
    });

    it('TAG_BATCH_STARTED sets isTagging and total', () => {
        const folder = makeFolder([]);
        const { result } = renderHook(() => useAITagger(folder));

        // Grab the listener registered with onMessage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listener = (chrome.runtime.onMessage.addListener as any).mock.calls[0]?.[0];
        expect(listener).toBeDefined();

        act(() => { listener({ type: 'TAG_BATCH_STARTED', total: 5 }); });
        expect(result.current.isTagging).toBe(true);
        expect(result.current.taggingProgress).toEqual({ done: 0, total: 5 });
    });

    it('TAG_UPDATED increments done and stores tags', () => {
        const url = 'https://example.com';
        const folder = makeFolder([{ id: 'b1', url, title: 'Example' }]);
        const { result } = renderHook(() => useAITagger(folder));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listener = (chrome.runtime.onMessage.addListener as any).mock.calls[0]?.[0];
        act(() => { listener({ type: 'TAG_BATCH_STARTED', total: 1 }); });
        act(() => { listener({ type: 'TAG_UPDATED', url, tags: ['Dev'] }); });

        expect(result.current.tags[url]).toEqual(['Dev']);
        expect(result.current.taggingProgress.done).toBe(1);
    });

    it('TAG_BATCH_DONE clears isTagging', () => {
        const folder = makeFolder([]);
        const { result } = renderHook(() => useAITagger(folder));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listener = (chrome.runtime.onMessage.addListener as any).mock.calls[0]?.[0];
        act(() => { listener({ type: 'TAG_BATCH_STARTED', total: 1 }); });
        expect(result.current.isTagging).toBe(true);
        act(() => { listener({ type: 'TAG_BATCH_DONE', count: 1 }); });
        expect(result.current.isTagging).toBe(false);
    });

    it('TAG_BATCH_FAILED clears isTagging', () => {
        const folder = makeFolder([]);
        const { result } = renderHook(() => useAITagger(folder));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listener = (chrome.runtime.onMessage.addListener as any).mock.calls[0]?.[0];
        act(() => { listener({ type: 'TAG_BATCH_STARTED', total: 1 }); });
        act(() => { listener({ type: 'TAG_BATCH_FAILED', error: 'AI error' }); });
        expect(result.current.isTagging).toBe(false);
    });
});
