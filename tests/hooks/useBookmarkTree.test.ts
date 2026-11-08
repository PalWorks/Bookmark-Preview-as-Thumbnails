// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBookmarkTree } from '../../src/popup/hooks/useBookmarkTree';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';

describe('useBookmarkTree (reactive)', () => {
    it('loads the tree and selects the Bookmarks bar', async () => {
        fakeBookmarks.seed('1', 'A', 'https://a.example/');
        const { result } = renderHook(() => useBookmarkTree());
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
        expect(result.current.bookmarkTree.map(n => n.title)).toEqual(['Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks']);
    });

    it('refreshes once per burst of bookmark events made elsewhere', async () => {
        const { result } = renderHook(() => useBookmarkTree());
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
        const spy = vi.spyOn(chrome.bookmarks, 'getTree');
        await act(async () => {
            for (let i = 0; i < 20; i++) await chrome.bookmarks.create({ parentId: '1', title: `B${i}`, url: `https://b${i}.example/` });
        });
        await waitFor(() => expect(result.current.currentFolder?.children).toHaveLength(20));
        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('moves to the nearest surviving ancestor when the open folder is deleted', async () => {
        const work = fakeBookmarks.seed('1', 'Work');
        const deep = fakeBookmarks.seed(work.id, 'Deep');
        const { result } = renderHook(() => useBookmarkTree());
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
        act(() => result.current.handleNavigate(deep.id));
        await waitFor(() => expect(result.current.currentFolder?.id).toBe(deep.id));
        // Let the ancestor tracking settle, then delete the folder's parent.
        await act(async () => { await new Promise(r => setTimeout(r, 20)); });
        await act(async () => { await chrome.bookmarks.removeTree(work.id); });
        await waitFor(() => expect(result.current.selectedFolderId).toBe('1'));
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
    });

    it('re-runs an active search when bookmarks change', async () => {
        const { result } = renderHook(() => useBookmarkTree());
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
        act(() => result.current.setSearchQuery('kitten'));
        await waitFor(() => expect(result.current.searchResults).toHaveLength(0));
        await act(async () => { await chrome.bookmarks.create({ parentId: '2', title: 'Kitten pics', url: 'https://kitten.example/' }); });
        await waitFor(() => expect(result.current.searchResults.map(r => r.title)).toEqual(['Kitten pics']));
    });

    it('pauses during a bookmark import and refreshes when it ends', async () => {
        const { result } = renderHook(() => useBookmarkTree());
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
        const spy = vi.spyOn(chrome.bookmarks, 'getTree');
        act(() => fakeBookmarks.onImportBegan._emit());
        await act(async () => {
            for (let i = 0; i < 5; i++) await chrome.bookmarks.create({ parentId: '1', title: `I${i}`, url: `https://i${i}.example/` });
            await new Promise(r => setTimeout(r, 200));
        });
        expect(spy).not.toHaveBeenCalled();
        act(() => fakeBookmarks.onImportEnded._emit());
        await waitFor(() => expect(result.current.currentFolder?.children).toHaveLength(5));
    });

    it('removes its listeners on unmount', async () => {
        const { unmount, result } = renderHook(() => useBookmarkTree());
        await waitFor(() => expect(result.current.currentFolder?.id).toBe('1'));
        expect(fakeBookmarks.onCreated._count()).toBe(1);
        unmount();
        expect(fakeBookmarks.onCreated._count()).toBe(0);
        expect(fakeBookmarks.onImportEnded._count()).toBe(0);
    });
});
