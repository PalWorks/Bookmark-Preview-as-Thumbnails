// SPDX-License-Identifier: AGPL-3.0-only
// 1.4.0 flows in the real App: selection and bulk actions, folder colours, hidden
// from search, ratings and the Trash switch.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, configure } from '@testing-library/react';
import App from '../../src/popup/App';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';
import { connectTrash } from '../sw_bridge';
import { localStore, syncStore } from '../setup';

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
    window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => { }, removeEventListener: () => { }, addListener: () => { }, removeListener: () => { },
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

function seed() {
    const a = fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
    const b = fakeBookmarks.seed('1', 'Beta', 'https://beta.example/');
    const c = fakeBookmarks.seed('1', 'Gamma', 'https://gamma.example/');
    const folder = fakeBookmarks.seed('1', 'Recipes');
    return { a, b, c, folder };
}

describe('1.4.0 in the App', { timeout: 20000 }, () => {
    it('selects a range with Shift+click and deletes it as one Undo', async () => {
        connectTrash();
        const { a, c } = seed();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Select items' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Gamma' }), { shiftKey: true });
        await screen.findByText('3 selected');
        const bar = screen.getByRole('region', { name: 'Selection' });
        fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
        await screen.findByText(/Deleted 3 items/);
        expect(fakeBookmarks.has(a.id)).toBe(false);
        expect(fakeBookmarks.has(c.id)).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(fakeBookmarks.titlesIn('1')).toEqual(['Alpha', 'Beta', 'Gamma', 'Recipes']));
    });

    it('moves the selection to a folder and Undo puts it back', async () => {
        connectTrash();
        const { folder } = seed();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Select items' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Gamma' }));
        fireEvent.click(within(screen.getByRole('region', { name: 'Selection' })).getByRole('button', { name: /Move to/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Move to…' });
        fireEvent.click(within(dialog).getByLabelText('Bookmarks bar › Recipes'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));
        await screen.findByText("Moved 2 items to 'Recipes'.");
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual(['Beta', 'Gamma']);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await screen.findByText('Moved 2 items back.');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Alpha', 'Beta', 'Gamma', 'Recipes']);
    });

    it('Ctrl+A selects everything in view and Escape leaves selection mode', async () => {
        connectTrash();
        seed();
        render(<App />);
        await screen.findByRole('button', { name: 'Delete Alpha' });
        // Ctrl+A acts on what is loaded when it is pressed; repeat (it is idempotent) until all four are.
        await waitFor(() => {
            fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
            expect(screen.getByText('4 selected')).toBeTruthy();
        });
        fireEvent.keyDown(document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Selection' })).toBeNull());
    });

    it('colours a folder and hides it from search through the More actions menu', async () => {
        connectTrash();
        const { folder } = seed();
        fakeBookmarks.seed(folder.id, 'Alpha soup', 'https://soup.example/alpha');
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'More actions for Recipes' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Colour…' }));
        const dialog = await screen.findByRole('dialog', { name: 'Folder colour' });
        fireEvent.click(within(dialog).getByLabelText('Teal'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save colour' }));
        await waitFor(() => expect(localStore[`fpref_${folder.id}`]).toEqual({ color: 'teal' }));

        fireEvent.click(screen.getByRole('button', { name: 'More actions for Recipes' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide from search' }));
        await screen.findByText(/'Recipes' and its subfolders are hidden from search/);
        expect(localStore[`fpref_${folder.id}`]).toEqual({ color: 'teal', hideFromSearch: true });

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search bookmarks' }), { target: { value: 'alpha' } });
        await screen.findByText(/1 more match in folders hidden from search/);
        fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
        await screen.findByRole('button', { name: 'Delete Alpha soup' });
    });

    it('rates a link from list view', async () => {
        connectTrash();
        seed();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'List view' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Rate for Alpha' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rate this link' });
        fireEvent.click(within(dialog).getByLabelText('4'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save rating' }));
        await screen.findByRole('button', { name: 'Rated 4 of 5. Change rating for Alpha' });
        expect((localStore['meta_https://alpha.example/'] as { rating?: number }).rating).toBe(4);
    });

    it('the Trash switch turns off keeping deletes made elsewhere', async () => {
        connectTrash();
        seed();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: /^Trash/ }));
        const sw = await screen.findByRole('switch', { name: /Also keep bookmarks deleted outside this extension/ });
        expect((sw as HTMLInputElement).checked).toBe(true);
        fireEvent.click(sw);
        await waitFor(() => expect(syncStore.trashExternal).toBe(false));
    });
});
