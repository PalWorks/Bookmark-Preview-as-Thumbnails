// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end in jsdom: the real App, the real trash service (via the bridge) and
// the in-memory bookmark tree.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, act, configure } from '@testing-library/react';
import App from '../../src/popup/App';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';
import { connectTrash } from '../sw_bridge';
import { localStore } from '../setup';

// Real timers and a 150 ms coalesced tree refresh: allow for a loaded CI machine.
configure({ asyncUtilTimeout: 5000 });

let narrow = false;
beforeEach(() => {
    narrow = false;
    window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width: 719px') ? narrow : false,
        media: query,
        onchange: null,
        addEventListener: () => { },
        removeEventListener: () => { },
        addListener: () => { },
        removeListener: () => { },
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

function seed() {
    const soup = fakeBookmarks.seed('1', 'Soup', 'https://soup.example/');
    const folder = fakeBookmarks.seed('1', 'Recipes');
    fakeBookmarks.seed(folder.id, 'Cake', 'https://cake.example/');
    const sub = fakeBookmarks.seed(folder.id, 'Drinks');
    fakeBookmarks.seed(sub.id, 'Tea', 'https://tea.example/');
    return { soup, folder };
}

describe('App', { timeout: 20000 }, () => {
    it('deletes from a tile with Undo, and the bookmark comes back', async () => {
        connectTrash();
        const { soup } = seed();
        render(<App />);
        const del = await screen.findByRole('button', { name: 'Delete Soup' });
        fireEvent.click(del);
        await screen.findByText("Deleted 'Soup'");
        expect(fakeBookmarks.has(soup.id)).toBe(false);
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Soup' })).toBeNull());

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await screen.findByText('Restored to Bookmarks bar');
        await screen.findByRole('button', { name: 'Delete Soup' });
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Soup', 'Recipes']);
    });

    it('shows deep folder counts and an uncaptured bookmark as its domain', async () => {
        connectTrash();
        seed();
        render(<App />);
        // Recipes holds Cake plus Tea inside Drinks.
        const tileCount = await screen.findByText('2 bookmarks');
        expect(tileCount.getAttribute('aria-label')).toBe('2 bookmarks, including subfolders');
        expect(screen.getAllByText('soup.example').length).toBeGreaterThan(0);
    });

    it('opens Trash from the sidebar, restores to a chosen folder, and empties with a typed confirmation', async () => {
        connectTrash();
        const { folder } = seed();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Recipes' }));
        await screen.findByText("Deleted 'Recipes' (2 bookmarks)");

        fireEvent.click(screen.getByRole('button', { name: /^Trash/ }));
        await screen.findByRole('heading', { name: 'Trash' });
        const row = (await screen.findByText(/Recipes, 2 bookmarks, from Bookmarks bar/)).closest('li')!;
        fireEvent.click(within(row).getByRole('button', { name: 'Restore to…' }));
        const dialog = await screen.findByRole('dialog', { name: 'Restore to…' });
        const restoreHere = within(dialog).getByRole('button', { name: 'Restore here' }) as HTMLButtonElement;
        expect(restoreHere.disabled).toBe(true); // no default destination
        fireEvent.click(within(dialog).getByLabelText('Other bookmarks'));
        fireEvent.click(restoreHere);
        await screen.findByText('Restored to Other bookmarks');
        expect(fakeBookmarks.titlesIn('2')).toEqual(['Recipes']);
        expect(fakeBookmarks.has(folder.id)).toBe(false); // a new copy, new ids

        // Delete again and empty Trash.
        const copy = fakeBookmarks.tree('2').children![0];
        await act(async () => { await chrome.runtime.sendMessage({ type: 'TRASH_DELETE', ids: [copy.id] }); });
        await screen.findByText(/Recipes, 2 bookmarks, from Other bookmarks/);
        localStore['thumb_https://tea.example/'] = { id: 'https://tea.example/', base64: 'data:image/webp;base64,AAAA' };
        fireEvent.click(screen.getByRole('button', { name: 'Empty Trash' }));
        const confirm = await screen.findByRole('dialog', { name: 'Empty Trash?' });
        const go = within(confirm).getByRole('button', { name: 'Empty Trash' }) as HTMLButtonElement;
        expect(go.disabled).toBe(true);
        fireEvent.change(within(confirm).getByLabelText(/to confirm/), { target: { value: 'empty' } });
        expect(go.disabled).toBe(false);
        fireEvent.click(go);
        await screen.findByText('Trash emptied');
        await screen.findByText('Nothing in Trash.');
        expect(localStore['thumb_https://tea.example/']).toBeUndefined();
    });

    it('context menu Delete goes to Trash without a confirm dialog', async () => {
        connectTrash();
        const { soup } = seed();
        const original = window.confirm;
        let asked = 0;
        window.confirm = (() => { asked++; return true; }) as typeof window.confirm;
        try {
            render(<App />);
            fireEvent.click(await screen.findByRole('button', { name: 'More actions for Soup' }));
            const menu = await screen.findByRole('menu');
            fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
            await screen.findByText("Deleted 'Soup'");
            expect(fakeBookmarks.has(soup.id)).toBe(false);
            expect(asked).toBe(0);
        } finally {
            window.confirm = original;
        }
    });

    it('Delete key on a focused tile deletes it', async () => {
        connectTrash();
        const { soup } = seed();
        render(<App />);
        const link = await screen.findByRole('link', { name: 'Soup' });
        link.focus();
        fireEvent.keyDown(link, { key: 'Delete' });
        await screen.findByText("Deleted 'Soup'");
        expect(fakeBookmarks.has(soup.id)).toBe(false);
    });

    it('on a phone the folder panel is a drawer behind the Folders button', async () => {
        narrow = true;
        connectTrash();
        seed();
        render(<App />);
        const toggle = await screen.findByRole('button', { name: 'Folders' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('navigation', { name: 'Folders' })).toBeNull();
        fireEvent.click(toggle);
        const nav = await screen.findByRole('navigation', { name: 'Folders' });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(within(nav).getByRole('button', { name: /^Other bookmarks/ }));
        await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Folders' })).toBeNull());
        await screen.findByRole('heading', { name: 'Other bookmarks' });
    });

    it('on desktop the Folders button hides the panel and remembers it', async () => {
        connectTrash();
        seed();
        render(<App />);
        await screen.findByRole('navigation', { name: 'Folders' });
        fireEvent.click(screen.getByRole('button', { name: 'Folders' }));
        await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Folders' })).toBeNull());
        const sync = await chrome.storage.sync.get('sidebarHidden');
        expect(sync.sidebarHidden).toBe(true);
    });
});
