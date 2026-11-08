// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTrash } from '../../src/popup/hooks/useTrash';
import { useToast } from '../../src/popup/hooks/useToast';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';
import { connectTrash } from '../sw_bridge';

function setup(opts: { readOnly?: boolean } = {}) {
    const onOpenFolder = vi.fn();
    const onOpenTrash = vi.fn();
    const onRestoredFocus = vi.fn();
    const hook = renderHook(() => {
        const toast = useToast();
        const trash = useTrash({ toast, onOpenFolder, onOpenTrash, onRestoredFocus, readOnly: !!opts.readOnly });
        return { toast, trash };
    });
    return { ...hook, onOpenFolder, onOpenTrash, onRestoredFocus };
}

describe('useTrash', () => {
    it('deletes with an Undo toast, then Undo restores and offers Open folder', async () => {
        connectTrash();
        const folder = fakeBookmarks.seed('1', 'Work');
        const doc = fakeBookmarks.seed(folder.id, 'Quarterly report with a very long title that keeps going', 'https://doc.example/');
        const { result, onOpenFolder, onRestoredFocus } = setup();

        await act(async () => { await result.current.trash.deleteItems([{ id: doc.id, title: doc.title }]); });
        const t = result.current.toast.toast!;
        expect(t.message).toBe("Deleted 'Quarterly report with a very long title…'");
        expect(t.actions.map(a => a.label)).toEqual(['Undo', 'View Trash']);
        expect(t.onUndo).toBeTypeOf('function');
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual([]);
        await waitFor(() => expect(result.current.trash.badgeCount).toBe(1));

        await act(async () => { t.onUndo!(); });
        await waitFor(() => expect(result.current.toast.toast?.message).toBe('Restored to Bookmarks bar › Work'));
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual([doc.title]);
        expect(onRestoredFocus).toHaveBeenCalled();
        await waitFor(() => expect(result.current.trash.badgeCount).toBe(0));

        act(() => result.current.toast.toast!.actions.find(a => a.label === 'Open folder')!.onClick());
        expect(onOpenFolder).toHaveBeenCalledWith(folder.id);
    });

    it('a folder delete names the folder and its bookmark count', async () => {
        connectTrash();
        const folder = fakeBookmarks.seed('1', 'Recipes');
        fakeBookmarks.seed(folder.id, 'A', 'https://a.example/');
        fakeBookmarks.seed(folder.id, 'B', 'https://b.example/');
        const { result } = setup();
        await act(async () => { await result.current.trash.deleteItems([{ id: folder.id, title: 'Recipes' }]); });
        expect(result.current.toast.toast?.message).toBe("Deleted 'Recipes' (2 bookmarks)");
    });

    it('Duplicate Finder deletes read as removed duplicates', async () => {
        connectTrash();
        const a = fakeBookmarks.seed('2', 'A', 'https://dup.example/');
        const b = fakeBookmarks.seed('2', 'A', 'https://dup.example/');
        const { result } = setup();
        await act(async () => {
            await result.current.trash.deleteItems([{ id: a.id, title: 'A' }, { id: b.id, title: 'A' }], { origin: 'duplicate-finder' });
        });
        expect(result.current.toast.toast?.message).toBe('Removed 2 duplicates');
    });

    it('explains a protected folder and removes nothing', async () => {
        connectTrash();
        const { result } = setup();
        await act(async () => { await result.current.trash.deleteItems([{ id: '1', title: 'Bookmarks bar' }]); });
        expect(result.current.toast.toast).toMatchObject({ tone: 'error' });
        expect(result.current.toast.toast?.message).toMatch(/Chrome folder and can't be deleted\. Nothing was removed\./);
    });

    it('retries once when the worker was asleep', async () => {
        const { sendMessage } = connectTrash({ failFirstSend: true });
        const bm = fakeBookmarks.seed('2', 'X', 'https://x.example/');
        const { result } = setup();
        await act(async () => { await result.current.trash.deleteItems([{ id: bm.id, title: 'X' }]); });
        expect(result.current.toast.toast?.message).toBe("Deleted 'X'");
        const deletes = sendMessage.mock.calls.filter(c => (c[0] as { type: string }).type === 'TRASH_DELETE');
        expect(deletes).toHaveLength(2);
        expect((deletes[0][0] as { requestId: string }).requestId).toBe((deletes[1][0] as { requestId: string }).requestId);
    });

    it('is read-only in incognito pages', async () => {
        const { sendMessage } = connectTrash();
        const bm = fakeBookmarks.seed('2', 'X', 'https://x.example/');
        const { result } = setup({ readOnly: true });
        await act(async () => { await result.current.trash.deleteItems([{ id: bm.id, title: 'X' }]); });
        expect(result.current.toast.toast?.message).toMatch(/regular windows only/);
        expect(sendMessage.mock.calls.some(c => (c[0] as { type: string }).type === 'TRASH_DELETE')).toBe(false);
        expect(fakeBookmarks.has(bm.id)).toBe(true);
    });

    it('reloads when the worker broadcasts TRASH_CHANGED', async () => {
        const { service } = connectTrash();
        const bm = fakeBookmarks.seed('2', 'X', 'https://x.example/');
        const { result } = setup();
        await waitFor(() => expect(result.current.trash.loading).toBe(false));
        expect(result.current.trash.operations).toHaveLength(0);
        // Another tab deletes: this hook hears TRASH_CHANGED only.
        await act(async () => { await service.deleteItems({ ids: [bm.id] }); });
        await waitFor(() => expect(result.current.trash.operations).toHaveLength(1));
    });

    it('empties Trash and reports it', async () => {
        connectTrash();
        const bm = fakeBookmarks.seed('2', 'X', 'https://x.example/');
        const { result } = setup();
        await act(async () => { await result.current.trash.deleteItems([{ id: bm.id, title: 'X' }]); });
        await act(async () => { await result.current.trash.empty(); });
        expect(result.current.toast.toast?.message).toBe('Trash emptied');
        await waitFor(() => expect(result.current.trash.badgeCount).toBe(0));
    });
});
