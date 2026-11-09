// SPDX-License-Identifier: AGPL-3.0-only
// 1.6.0: the settings menu layout (Generate Preview sub-menu, icon-only backup row,
// AI Settings entry) and the in-product feedback form.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, configure } from '@testing-library/react';
import App from '../../src/popup/App';
import { FeedbackDialog } from '../../src/components/FeedbackDialog';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
    window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => { }, removeEventListener: () => { }, addListener: () => { }, removeListener: () => { },
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

const diagnostics = { version: '1.6.0', browser: 'Chrome/153.0.0.0 on Linux', bookmarks: 3, folders: 1, view: 'grid' };

async function openMenu() {
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    return screen.getByRole('menu');
}

describe('settings menu (1.6.0)', { timeout: 20000 }, () => {
    it('the Folders toggle is an icon with a name and a tooltip, no visible text', async () => {
        render(<App />);
        const toggle = await screen.findByRole('button', { name: 'Folders' });
        expect(toggle.textContent).toBe('');
        expect(toggle.getAttribute('title')).toMatch(/folders/i);
    });

    it('capture options sit under a collapsed Generate Preview settings item', async () => {
        render(<App />);
        const menu = await openMenu();
        expect(within(menu).queryByText('Use Incognito Window')).toBeNull();
        const disclosure = within(menu).getByRole('menuitem', { name: /Generate Preview settings/ });
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(disclosure);
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        const group = within(menu).getByRole('group', { name: 'Generate Preview settings' });
        expect(within(group).getByText('Use Incognito Window')).toBeTruthy();
        expect(within(group).getByText('Use Active Tab Capture')).toBeTruthy();
        expect(within(group).getByLabelText('Screen Capture Delay')).toBeTruthy();
        // Each option explains itself on hover, in plain words.
        expect(within(group).getByRole('menuitemcheckbox', { name: /Use Incognito Window/ }).getAttribute('title')).toMatch(/sign-ins or cookies/);
        expect(within(group).getByRole('menuitemcheckbox', { name: /Use Active Tab Capture/ }).getAttribute('title')).toMatch(/blank or broken/);
        expect(within(group).getByLabelText('Screen Capture Delay').closest('[title]')?.getAttribute('title')).toMatch(/1000 = 1 second/);
        // The menu stays open after expanding.
        expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('backup actions are icon buttons in one row, each named for screen readers', async () => {
        render(<App />);
        const menu = await openMenu();
        const row = within(menu).getByRole('group', { name: 'Backup' });
        const buttons = within(row).getAllByRole('menuitem');
        expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual([
            'Export Backup: settings and preview images',
            'Export Settings: small file, no images or API key',
            'Import Backup: restore a backup or settings file',
        ]);
        for (const b of buttons) expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
    });

    it('AI Settings replaces Auto-Tag and opens the AI page', async () => {
        render(<App />);
        const menu = await openMenu();
        expect(within(menu).queryByText('Auto-Tag Bookmarks')).toBeNull();
        const toolbarAI = screen.getByRole('button', { name: 'AI Settings', pressed: false });
        fireEvent.click(within(menu).getByRole('menuitem', { name: /AI Settings/ }));
        await waitFor(() => expect(toolbarAI.getAttribute('aria-pressed')).toBe('true'));
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('the folder panel no longer carries an AI Settings link', async () => {
        render(<App />);
        const nav = await screen.findByRole('navigation', { name: 'Folders' });
        expect(within(nav).queryByText('AI Settings')).toBeNull();
        expect(within(nav).getByText('Trash')).toBeTruthy();
    });

    it('export points out of the app and import points in', async () => {
        render(<App />);
        const menu = await openMenu();
        const row = within(menu).getByRole('group', { name: 'Backup' });
        const [exp, , imp] = within(row).getAllByRole('menuitem');
        expect(exp.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-upload/);
        expect(imp.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-download/);
    });

    it('Submit Feedback opens the in-built form instead of an email link', async () => {
        fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
        const create = vi.spyOn(chrome.tabs, 'create');
        render(<App />);
        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole('menuitem', { name: /Submit Feedback/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Send feedback' });
        expect(within(dialog).getByLabelText('Your message')).toBeTruthy();
        expect(within(dialog).getByText(/\d+ bookmarks, \d+ folders, grid view/)).toBeTruthy();
        expect(create).not.toHaveBeenCalled();
    });
});

describe('list view (1.6.0)', { timeout: 20000 }, () => {
    it('row Delete is a trash icon only, named for screen readers and explained on hover', async () => {
        fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'List view' }));
        const del = await screen.findByRole('button', { name: 'Delete Alpha' });
        expect(del.textContent).toBe('');
        expect(del.getAttribute('title')).toBe('Delete (you can undo)');
    });
});

describe('FeedbackDialog', () => {
    it('sends category, message, reply address and diagnostics, then thanks the user', async () => {
        const send = vi.fn().mockResolvedValue({ ok: true });
        render(<FeedbackDialog onClose={() => { }} diagnostics={diagnostics} send={send} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Something is broken' }));
        fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Thumbnails stay blank on one site.' } });
        fireEvent.change(screen.getByLabelText('Email for a reply (optional)'), { target: { value: 'me@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
        await screen.findByRole('dialog', { name: 'Feedback sent' });
        expect(send).toHaveBeenCalledWith({
            category: 'bug',
            message: 'Thumbnails stay blank on one site.',
            replyTo: 'me@example.com',
            diagnostics,
        });
        expect(screen.getByText(/We will reply to the address you gave/)).toBeTruthy();
    });

    it('leaves diagnostics out when unticked', async () => {
        const send = vi.fn().mockResolvedValue({ ok: true });
        render(<FeedbackDialog onClose={() => { }} diagnostics={diagnostics} send={send} />);
        fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Please add a list density option.' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /Include technical details/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
        await screen.findByRole('dialog', { name: 'Feedback sent' });
        expect(send.mock.calls[0][0]).not.toHaveProperty('diagnostics');
    });

    it('a double submit sends once', async () => {
        let resolve: (v: { ok: true }) => void = () => { };
        const send = vi.fn(() => new Promise<{ ok: true }>(r => { resolve = r; }));
        render(<FeedbackDialog onClose={() => { }} diagnostics={diagnostics} send={send} />);
        fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Sent only once, please.' } });
        const form = document.getElementById('feedback-form') as HTMLFormElement;
        fireEvent.submit(form);
        fireEvent.submit(form);
        resolve({ ok: true });
        await screen.findByRole('dialog', { name: 'Feedback sent' });
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('validates before sending and keeps what was typed on a send error', async () => {
        const send = vi.fn().mockResolvedValue({ ok: false, error: 'No connection. Please check your network.' });
        render(<FeedbackDialog onClose={() => { }} diagnostics={diagnostics} send={send} />);
        fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'hi' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/write a little more/);
        expect(send).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'A longer message that is fine.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
        expect((await screen.findByRole('alert')).textContent).toBe('No connection. Please check your network.');
        expect((screen.getByLabelText('Your message') as HTMLTextAreaElement).value).toBe('A longer message that is fine.');
    });
});
