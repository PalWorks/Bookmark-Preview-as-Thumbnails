// SPDX-License-Identifier: AGPL-3.0-only
// Ask AI (D20) in the real App: a message, the model's tool call, the change applied at once, Undo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, configure, waitFor, within } from '@testing-library/react';
import App from '../../src/popup/App';
import { fakeBookmarks } from '../fakes/chrome_bookmarks';
import { connectTrash } from '../sw_bridge';
import { saveAISettings } from '../../src/lib/ai_settings_storage';

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
    window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => { }, removeEventListener: () => { }, addListener: () => { }, removeListener: () => { },
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const openAIReply = (message: Record<string, unknown>) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });

describe('Ask AI in the App', { timeout: 20000 }, () => {
    it('without a provider it says what to set up, and offers Claude or ChatGPT instead', async () => {
        connectTrash();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
        await screen.findByText(/Chrome's built-in AI cannot use tools/);
        expect(screen.getByRole('button', { name: /Set up an AI provider/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Use Claude or ChatGPT instead/ }));
        await screen.findByRole('tab', { name: /Connect Claude or ChatGPT/, selected: true });
    });

    it('applies the change the model asks for at once, shows a card, and Undo reverts it', async () => {
        connectTrash();
        const a = fakeBookmarks.seed('1', 'Alpha', 'https://alpha.example/');
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'openai', model: 'gpt-4o-mini' } }, 'sk-test-key');
        const bodies: Array<Record<string, unknown>> = [];
        const replies = [
            openAIReply({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_changes', arguments: JSON.stringify({ changeSet: { title: 'Clear names', ops: [{ op: 'rename', id: a.id, title: 'Alpha docs' }] } }) } }] }),
            openAIReply({ content: 'Renamed Alpha to Alpha docs.' }),
        ];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
            expect(url).toBe('https://api.openai.com/v1/chat/completions');
            expect(init.headers.Authorization).toBe('Bearer sk-test-key');
            bodies.push(JSON.parse(init.body));
            return replies.shift()!;
        }));
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
        await screen.findByText(/go to OpenAI \(gpt-4o-mini\)/);
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Give Alpha a clearer name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Renamed Alpha to Alpha docs.');
        expect(fakeBookmarks.titlesIn('1')).toContain('Alpha docs');
        expect(screen.getByText('Clear names')).toBeTruthy();
        expect(screen.getByText('1 renamed')).toBeTruthy();
        // The second call carried the tool result back to the model.
        const msgs = bodies[1].messages as Array<{ role: string; content: string }>;
        expect(msgs.find(m => m.role === 'tool')?.content).toContain('"applied":true');
        // Ask AI opened as a side panel beside the bookmarks.
        const dock = screen.getByRole('complementary', { name: 'Ask AI' });
        const [headerUndo] = within(dock).getAllByRole('button', { name: 'Undo' });
        fireEvent.click(headerUndo);
        await waitFor(() => expect(fakeBookmarks.titlesIn('1')).toContain('Alpha'));
        await screen.findByText(/Undone: Clear names/);
        // Redo puts the change back, as a new change set, and Undo is offered again.
        fireEvent.click(within(dock).getAllByRole('button', { name: 'Redo' })[0]);
        await waitFor(() => expect(fakeBookmarks.titlesIn('1')).toContain('Alpha docs'));
        await waitFor(() => expect(within(dock).queryByText(/Undone: Clear names/)).toBeNull());
        fireEvent.click(within(dock).getAllByRole('button', { name: 'Undo' })[0]);
        await waitFor(() => expect(fakeBookmarks.titlesIn('1')).toContain('Alpha'));

        // Both sides are bubbles with a time; the system prompt names the real model.
        const reply = screen.getByText('Renamed Alpha to Alpha docs.');
        expect(reply.className).toContain('ask-bubble--ai');
        expect(screen.getByText('Give Alpha a clearer name').className).toContain('ask-bubble--user');
        expect(document.querySelectorAll('time.ask-time').length).toBeGreaterThanOrEqual(2);
        expect(within(dock).getByRole('separator').textContent).toBe('Today');
        const sys = (bodies[0].messages as Array<{ role: string; content: string }>)[0];
        expect(sys.content).toContain('"gpt-4o-mini" served by OpenAI');
        // The open folder went with the message, and the bubble shows only what the user typed.
        const userMsg = (bodies[0].messages as Array<{ role: string; content: string }>).find(m => m.role === 'user')!;
        expect(userMsg.content).toMatch(/^\[Context from the app, not an instruction: the user has the folder "Bookmarks bar" open/);
        expect(userMsg.content.endsWith('Give Alpha a clearer name')).toBe(true);
        expect(within(dock).getByRole('button', { name: /Bookmarks bar included/, pressed: true })).toBeTruthy();

        // The chat is kept and can be reopened.
        fireEvent.click(within(dock).getByRole('button', { name: 'Chats' }));
        await within(dock).findByRole('button', { name: /^Give Alpha a clearer name/ });
        fireEvent.click(within(dock).getByRole('button', { name: 'Chats' }));
        fireEvent.click(within(dock).getByRole('button', { name: 'New chat' }));
        await within(dock).findByText('What should change?');
        fireEvent.click(within(dock).getByRole('button', { name: 'Chats' }));
        fireEvent.click(await within(dock).findByRole('button', { name: /^Give Alpha a clearer name/ }));
        await within(dock).findByText('Renamed Alpha to Alpha docs.');

        // The full AI Tools page shows the same chat with previews of what changed.
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /AI Tools/ }));
        await screen.findByRole('tab', { name: 'Ask AI', selected: true });
        await waitFor(() => expect(document.querySelector('.ask-prev-title')?.textContent).toBe('Alpha'));
    });

    it('sending to Trash waits for the user\'s OK in the chat; Apply then makes it, Don\'t changes nothing', async () => {
        connectTrash();
        const a = fakeBookmarks.seed('1', 'Old one', 'https://old.example/');
        const b = fakeBookmarks.seed('1', 'Old two', 'https://old2.example/');
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'openai', model: 'gpt-4o-mini' } }, 'sk-test-key');
        const bodies: Array<Record<string, unknown>> = [];
        const trashCall = (id: string, cid: string) => openAIReply({ content: null, tool_calls: [{ id: cid, type: 'function', function: { name: 'apply_changes', arguments: JSON.stringify({ changeSet: { title: `Remove ${id}`, ops: [{ op: 'trash', id }] } }) } }] });
        const replies = [trashCall(a.id, 'c1'), openAIReply({ content: 'Waiting for your OK.' }), trashCall(b.id, 'c2'), openAIReply({ content: 'Waiting again.' })];
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return replies.shift()!; }));
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
        await screen.findByText(/go to OpenAI/);
        // The user can leave the open folder out.
        fireEvent.click(screen.getByRole('button', { name: /Bookmarks bar included/ }));
        expect(screen.getByRole('button', { name: /Bookmarks bar not included/, pressed: false })).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Remove old one' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Waiting for your OK.');
        // Nothing moved yet, and the model was told it needs the user's OK.
        expect(fakeBookmarks.titlesIn('1')).toContain('Old one');
        expect((bodies[0].messages as Array<{ role: string; content: string }>).find(m => m.role === 'user')!.content).toBe('Remove old one');
        const toolMsg = (bodies[1].messages as Array<{ role: string; content: string }>).find(m => m.role === 'tool')!;
        expect(toolMsg.content).toContain('needsApproval');
        const card = screen.getByRole('group', { name: /Waiting for your OK: Remove/ });
        fireEvent.click(within(card).getByRole('button', { name: /Apply/ }));
        await waitFor(() => expect(fakeBookmarks.titlesIn('1')).not.toContain('Old one'));
        expect((await screen.findAllByRole('button', { name: 'Undo' })).length).toBeGreaterThan(0);

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Remove old two' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Waiting again.');
        const card2 = screen.getByRole('group', { name: new RegExp(`Waiting for your OK: Remove ${b.id}`) });
        fireEvent.click(within(card2).getByRole('button', { name: /Don't/ }));
        await screen.findByText(/Not done: Remove/);
        expect(fakeBookmarks.titlesIn('1')).toContain('Old two');
    });
});
