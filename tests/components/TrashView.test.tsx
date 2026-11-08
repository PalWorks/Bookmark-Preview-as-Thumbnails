// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { TrashView } from '../../src/components/TrashView';
import { Toast } from '../../src/components/Toast';
import { useTrash } from '../../src/popup/hooks/useTrash';
import { useToast } from '../../src/popup/hooks/useToast';
import { FakeBookmarks } from '../fakes/chrome_bookmarks';
import { connectTrash } from '../sw_bridge';

afterEach(() => cleanup());

function Harness({ readOnly = false, roots }: { readOnly?: boolean; roots: chrome.bookmarks.BookmarkTreeNode[] }) {
    const toast = useToast();
    const trash = useTrash({ toast, onOpenFolder: () => { }, onOpenTrash: () => { }, readOnly });
    return (
        <>
            <TrashView trash={trash} roots={roots} onBack={() => { }} />
            <Toast toast={toast.toast} onDismiss={toast.dismiss} />
        </>
    );
}

describe('TrashView', () => {
    it('shows the empty state with the retention promise', async () => {
        connectTrash();
        render(<Harness roots={[]} />);
        await screen.findByText('Nothing in Trash.');
        expect(screen.getByText(/stay here for 30 days/, { selector: '.sub-text' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Empty Trash' })).toBeNull();
    });

    it('a row whose folder moved into synced storage offers only "Restore to…" and groups the picker by storage', async () => {
        const fb = new FakeBookmarks({ accountStorage: true });
        (globalThis as unknown as { chrome: { bookmarks: unknown } }).chrome.bookmarks = fb.api();
        const local = fb.seed('1', 'Local');
        const item = fb.seed(local.id, 'Secret', 'https://secret.example/');
        const { service } = connectTrash();
        const del = await service.deleteItems({ ids: [item.id] });
        fb.relocate(local.id, '4');
        await service.restore({ operationId: del.operationId });

        const roots = fb.tree('0').children!;
        render(<Harness roots={roots} />);
        const row = (await screen.findByText(/Secret, from Bookmarks bar › Local/)).closest('li')!;
        expect(within(row).getByText(/Choose where to restore it/)).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'Restore' })).toBeNull();
        fireEvent.click(within(row).getByRole('button', { name: 'Restore to…' }));
        const dialog = await screen.findByRole('dialog', { name: 'Restore to…' });
        expect(within(dialog).getByText('On this device')).toBeTruthy();
        expect(within(dialog).getByText('Synced to your account')).toBeTruthy();
        fireEvent.change(within(dialog).getByLabelText('Search folders'), { target: { value: 'local' } });
        expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    });

    it('incognito: read-only banner and disabled actions', async () => {
        const { service } = connectTrash();
        const bm = (await chrome.bookmarks.create({ parentId: '2', title: 'X', url: 'https://x.example/' }));
        await service.deleteItems({ ids: [bm.id] });
        render(<Harness readOnly roots={[]} />);
        await screen.findByText(/Trash works in regular windows only/);
        const row = (await screen.findByText(/^X, from Other bookmarks/)).closest('li')!;
        expect((within(row).getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByRole('button', { name: 'Empty Trash' })).toBeNull();
    });
});
