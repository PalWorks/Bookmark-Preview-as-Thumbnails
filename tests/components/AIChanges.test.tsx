// SPDX-License-Identifier: AGPL-3.0-only
// AI changes (D18) in the real App: import an AI's answer, review, untick, apply, undo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, configure, within } from '@testing-library/react';
import App from '../../src/popup/App';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';
import { connectTrash } from '../sw_bridge';

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
    window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => { }, removeEventListener: () => { }, addListener: () => { }, removeListener: () => { },
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openMenuItem(name: RegExp) {
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('AI changes in the App', { timeout: 20000 }, () => {
    it('imports, reviews with ticks, applies as one step and undoes', async () => {
        connectTrash();
        const a = fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
        const b = fakeBookmarks.seed('1', 'Beta', 'https://beta.example/');
        render(<App />);
        await openMenuItem(/AI changes/);
        fireEvent.click(await screen.findByRole('button', { name: /Import changes/ }));
        const answer = JSON.stringify({ title: 'Tidy', ops: [
            { op: 'create_folder', tempId: 'new:1', parentId: '1', title: 'Greek' },
            { op: 'move', id: a.id, parentId: 'new:1' },
            { op: 'rename', id: b.id, title: 'Beta site' },
        ] });
        fireEvent.change(await screen.findByLabelText("The AI's answer"), { target: { value: answer } });
        fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));

        await screen.findByText('Nothing has changed yet. Untick anything you disagree with, then apply.');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Alpha', 'Beta']);
        // Untick the rename.
        const renames = screen.getByRole('region', { name: 'Renames' });
        fireEvent.click(within(renames).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }));
        await screen.findByText('Applied as one step. You can undo it from AI changes.');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Beta', 'Greek']);

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await screen.findByText('Undone.');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Alpha', 'Beta']);
    });

    it('unticking a new folder unticks the moves into it', async () => {
        connectTrash();
        const a = fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
        render(<App />);
        await openMenuItem(/AI changes/);
        fireEvent.click(await screen.findByRole('button', { name: /Import changes/ }));
        fireEvent.change(await screen.findByLabelText("The AI's answer"), { target: { value: JSON.stringify({ ops: [
            { op: 'create_folder', tempId: 'new:1', parentId: '1', title: 'Greek' },
            { op: 'move', id: a.id, parentId: 'new:1' },
        ] }) } });
        fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
        const folders = await screen.findByRole('region', { name: 'New folders' });
        fireEvent.click(within(folders).getByRole('checkbox'));
        const moves = screen.getByRole('region', { name: 'Moves' });
        expect((within(moves).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
        expect((screen.getByRole('button', { name: 'Apply 0 changes' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows why a set is refused and changes nothing', async () => {
        connectTrash();
        fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
        render(<App />);
        await openMenuItem(/AI changes/);
        fireEvent.click(await screen.findByRole('button', { name: /Import changes/ }));
        fireEvent.change(await screen.findByLabelText("The AI's answer"), { target: { value: '{"ops":[{"op":"rename","id":"999","title":"x"}]}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
        await screen.findByText(/1 of 1 changes can't be made/);
        expect(screen.getByText(/Unknown id, or outside the folders you shared/)).toBeTruthy();
    });

    it('shares only ticked folders, and nothing is ticked at first', async () => {
        connectTrash();
        const f = fakeBookmarks.seed('1', 'Work');
        fakeBookmarks.seed(f.id, 'Doc', 'https://doc.example/?token=secret');
        fakeBookmarks.seed('1', 'Private');
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        render(<App />);
        await openMenuItem(/AI changes/);
        fireEvent.click(await screen.findByRole('button', { name: 'Other ways: copy and paste' }));
        const dialog = await screen.findByRole('dialog');
        const boxes = within(dialog).getAllByRole('checkbox');
        expect(boxes.filter(b => (b as HTMLInputElement).checked)).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Copy for your AI' }));
        await screen.findByText('Choose at least one folder to share.');
        fireEvent.click(within(dialog).getByRole('checkbox', { name: /Work/ }));
        fireEvent.click(within(dialog).getByRole('checkbox', { name: /Remove the part of links/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Copy for your AI' }));
        await screen.findByText(/Copied\./);
        const text = writeText.mock.calls[0][0] as string;
        expect(text).toContain('https://doc.example/');
        expect(text).not.toContain('secret');
        expect(text).not.toContain('Private');
        expect(text).toContain('snapshotId');
    });
});
