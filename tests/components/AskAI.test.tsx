// SPDX-License-Identifier: AGPL-3.0-only
// Ask AI (D20) in the real App: a message, the model's tool call, the change applied at once, Undo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, configure, waitFor } from '@testing-library/react';
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
        await screen.findByRole('heading', { name: 'Connect Claude or ChatGPT' });
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
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(fakeBookmarks.titlesIn('1')).toContain('Alpha'));
        await screen.findByText(/Undone: Clear names/);
    });
});
