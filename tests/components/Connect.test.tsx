// SPDX-License-Identifier: AGPL-3.0-only
// Connect Claude or ChatGPT (D20): the switch, the address, the standing sign-in code and connected apps.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AgentsView } from '../../src/components/AgentsView';
import type { BridgeApi } from '../../src/popup/hooks/useBridge';
import type { ConnectorApi } from '../../src/popup/hooks/useConnector';
import type { BridgeState } from '../../src/sw/agent_bridge';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const roots = [{ id: '0', title: '', children: [{ id: '1', title: 'Bookmarks bar', children: [] }, { id: '2', title: 'Other bookmarks', children: [] }] }] as unknown as chrome.bookmarks.BookmarkTreeNode[];

function bridgeApi(state: Partial<BridgeState>): BridgeApi {
    const fn = () => vi.fn(async () => undefined);
    return {
        state: { enabled: false, status: 'off', clients: [], ...state } as BridgeState, busy: false,
        setEnabled: vi.fn(async () => ({ ok: true })), removePermission: fn(), setPromptGrant: fn(),
        openInvite: fn(), setInviteGrant: fn(), closeInvite: fn(), cancelPrompt: fn(), updateClient: fn(), removeClient: fn(), removeAll: fn(),
    };
}

const connector = (enabled: boolean): ConnectorApi => ({
    state: { enabled, status: enabled ? 'connected' : 'off', address: 'https://relay.example/mcp/abcdefghijklmnopqrstuv' },
    busy: false, setEnabled: vi.fn(async () => true), newAddress: vi.fn(async () => true),
});

describe('Connect Claude or ChatGPT', () => {
    it('off: one switch, no address yet', () => {
        const c = connector(false);
        render(<AgentsView api={bridgeApi({})} connector={c} roots={roots} hiddenFolderIds={new Set()} onBack={() => { }} readOnly={false} toast={() => { }} />);
        expect(screen.queryByText(/relay\.example/)).toBeNull();
        fireEvent.click(screen.getByRole('switch', { name: /Let Claude and ChatGPT organise my bookmarks/ }));
        expect(c.setEnabled).toHaveBeenCalledWith(true);
    });

    it('on: shows the address with Copy, asks for a standing code, and shows it with folders and mode', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const api = bridgeApi({ invite: { code: '482913', startedAt: Date.now(), expiresAt: Date.now() + 600_000, folderIds: ['1'], stripQuery: false, mode: 'change' } });
        render(<AgentsView api={api} connector={connector(true)} roots={roots} hiddenFolderIds={new Set()} onBack={() => { }} readOnly={false} toast={() => { }} />);
        expect(api.openInvite).toHaveBeenCalled();
        expect(screen.getByText('https://relay.example/mcp/abcdefghijklmnopqrstuv')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        expect(writeText).toHaveBeenCalledWith('https://relay.example/mcp/abcdefghijklmnopqrstuv');
        const card = screen.getByRole('region', { name: 'Sign-in code' });
        expect(within(card).getByText('482 913')).toBeTruthy();
        fireEvent.change(within(card).getByLabelText('What it may do'), { target: { value: 'propose' } });
        expect(api.setInviteGrant).toHaveBeenCalledWith(['1'], false, 'propose');
    });

    it('lists connected apps with where they connect from and what they may do', () => {
        const api = bridgeApi({ clients: [{ id: 'c1', name: 'Claude', pairedAt: Date.now(), folderIds: ['1'], stripQuery: false, mode: 'change', transport: 'remote' }] });
        render(<AgentsView api={api} connector={connector(false)} roots={roots} hiddenFolderIds={new Set()} onBack={() => { }} readOnly={false} toast={() => { }} />);
        const list = screen.getByRole('region', { name: 'Connected apps' });
        expect(within(list).getByText('online')).toBeTruthy();
        expect((within(list).getByLabelText('What Claude may do') as HTMLSelectElement).value).toBe('change');
    });
});
