// SPDX-License-Identifier: AGPL-3.0-only
// 1.5.0: Undo for rename and for Cut and Paste, in the real App.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, configure } from '@testing-library/react';
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

function seed() {
    const a = fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
    const b = fakeBookmarks.seed('1', 'Beta', 'https://beta.example/');
    const folder = fakeBookmarks.seed('1', 'Recipes');
    return { a, b, folder };
}

async function menu(name: string, item: string) {
    fireEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('Undo for rename and move in the App', { timeout: 20000 }, () => {
    it('renames from the menu and Undo puts the old name back', async () => {
        connectTrash();
        const { a } = seed();
        vi.spyOn(window, 'prompt').mockReturnValue('Alpha renamed');
        render(<App />);
        await menu('Alpha', 'Rename');
        await screen.findByText("Renamed to 'Alpha renamed'.");
        expect(fakeBookmarks.titlesIn('1')[0]).toBe('Alpha renamed');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await screen.findByText("Name changed back to 'Alpha'.");
        expect(fakeBookmarks.titlesIn('1')[0]).toBe('Alpha');
        expect(fakeBookmarks.has(a.id)).toBe(true);
    });

    it('Ctrl+Z undoes a rename while its toast shows', async () => {
        connectTrash();
        seed();
        vi.spyOn(window, 'prompt').mockReturnValue('B2');
        render(<App />);
        await menu('Beta', 'Rename');
        await screen.findByText("Renamed to 'B2'.");
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        await screen.findByText("Name changed back to 'Beta'.");
        expect(fakeBookmarks.titlesIn('1')[1]).toBe('Beta');
    });

    it('Undo leaves a newer name alone', async () => {
        connectTrash();
        const { a } = seed();
        vi.spyOn(window, 'prompt').mockReturnValue('Mine');
        render(<App />);
        await menu('Alpha', 'Rename');
        await screen.findByText("Renamed to 'Mine'.");
        await chrome.bookmarks.update(a.id, { title: 'Theirs' });
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await screen.findByText('It was renamed again since, so its name was left as it is.');
        expect(fakeBookmarks.titlesIn('1')[0]).toBe('Theirs');
    });

    it('a cancelled or unchanged rename shows nothing', async () => {
        connectTrash();
        seed();
        const p = vi.spyOn(window, 'prompt').mockReturnValue(null);
        render(<App />);
        await menu('Alpha', 'Rename');
        p.mockReturnValue('Alpha');
        await menu('Alpha', 'Rename');
        await new Promise(r => setTimeout(r, 200));
        expect(screen.queryByText(/Renamed to/)).toBeNull();
    });

    it('Cut and Paste into a folder, then Undo puts it back in place', async () => {
        connectTrash();
        const { folder } = seed();
        render(<App />);
        await menu('Alpha', 'Cut');
        await menu('Recipes', 'Paste');
        await screen.findByText("Moved 'Alpha' to 'Recipes'.");
        expect(fakeBookmarks.titlesIn(folder.id)).toEqual(['Alpha']);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await screen.findByText('Moved 1 item back.');
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Alpha', 'Beta', 'Recipes']);
    });

    it('pasting a folder into itself is refused with a reason and keeps the clipboard', async () => {
        connectTrash();
        const { folder } = seed();
        render(<App />);
        await menu('Recipes', 'Cut');
        await menu('Recipes', 'Paste');
        await screen.findByText("Nothing was moved. A folder can't go inside itself.");
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Alpha', 'Beta', 'Recipes']);
        fireEvent.click(await screen.findByRole('button', { name: 'More actions for Alpha' }));
        const paste = await screen.findByRole('menuitem', { name: 'Paste' });
        expect(paste.hasAttribute('disabled') || paste.getAttribute('aria-disabled') === 'true').toBe(false);
        expect(fakeBookmarks.has(folder.id)).toBe(true);
    });

    it('a cut item deleted elsewhere clears the clipboard after Paste', async () => {
        connectTrash();
        const { a } = seed();
        render(<App />);
        await menu('Alpha', 'Cut');
        await chrome.bookmarks.remove(a.id);
        await menu('Recipes', 'Paste');
        await screen.findByText(/Nothing was moved/);
        fireEvent.click(await screen.findByRole('button', { name: 'More actions for Beta' }));
        const paste = await screen.findByRole('menuitem', { name: 'Paste' });
        expect(paste.hasAttribute('disabled') || paste.getAttribute('aria-disabled') === 'true').toBe(true);
    });
});
