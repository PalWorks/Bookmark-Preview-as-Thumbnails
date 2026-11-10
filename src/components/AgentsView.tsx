// SPDX-License-Identifier: AGPL-3.0-only
//
// Connect Claude or ChatGPT (docs/designs/ai-assistant.md, D20): the online
// connector for the Claude and ChatGPT apps (phone included), the local helper
// for coding agents (docs/designs/agent-bridge.md), and every connected app with
// its folders and what it may do.

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Laptop, ShieldCheck, Smartphone } from 'lucide-react';
import { FolderChecklist } from './FolderChecklist';
import { Modal } from './Modal';
import type { BridgeApi, ConnectionMode } from '../popup/hooks/useBridge';
import type { ConnectorApi } from '../popup/hooks/useConnector';
import { PACKAGE_NAME, SETUP_COMMAND } from '../lib/bridge/protocol';
import { formatAgo, plural } from '../lib/utils';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface Props {
    api: BridgeApi;
    connector: ConnectorApi;
    roots: Node[];
    hiddenFolderIds: Set<string>;
    onBack: () => void;
    /** The AI Tools tab bar, shown under the header. */
    tabBar?: React.ReactNode;
    readOnly: boolean;
    toast: (message: string, tone?: 'error') => void;
}

const MODES: Array<{ value: ConnectionMode; label: string }> = [
    { value: 'change', label: 'Read and change (with Undo)' },
    { value: 'propose', label: 'Read and suggest (I review first)' },
    { value: 'read', label: 'Read only' },
];

function useNow(active: boolean): number {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setT(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    return t;
}

const ModeSelect: React.FC<{ id: string; value: ConnectionMode; onChange: (m: ConnectionMode) => void; label: string }> = ({ id, value, onChange, label }) => (
    <>
        <label className="visually-hidden" htmlFor={id}>{label}</label>
        <select id={id} className="text-field agents-mode" value={value} onChange={e => onChange(e.target.value as ConnectionMode)}>
            {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
    </>
);

export const AgentsView: React.FC<Props> = ({ api, connector, roots, hiddenFolderIds, onBack, tabBar, readOnly, toast }) => {
    const { state } = api;
    const cstate = connector.state;
    const [editing, setEditing] = useState<{ id: string; name: string; chosen: Set<string>; strip: boolean } | null>(null);
    const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
    const [confirmNewAddress, setConfirmNewAddress] = useState(false);
    const prompt = state?.prompt;
    const invite = state?.invite;
    const now = useNow(!!prompt || !!invite);
    const promptChosen = new Set(prompt?.folderIds ?? []);
    const online = !!cstate?.enabled;

    // While this page is open and the connector is on, keep a sign-in code showing.
    useEffect(() => {
        if (readOnly || !online) return;
        void api.openInvite();
        const timer = setInterval(() => { void api.openInvite(); }, 30_000);
        return () => { clearInterval(timer); void api.closeInvite(); };
    }, [online, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

    const copy = async (text: string, done: string) => {
        try { await navigator.clipboard.writeText(text); toast(done); }
        catch { toast("Couldn't copy. Select the text and copy it yourself.", 'error'); }
    };

    const toggleLocal = async (on: boolean) => {
        const res = await api.setEnabled(on);
        if (!res.ok) toast(res.error ?? "Couldn't change that.", 'error');
    };

    const toggleOnline = async (on: boolean) => {
        const ok = await connector.setEnabled(on);
        if (!ok) toast("Couldn't change that. Try again.", 'error');
    };

    const onlineStatus = (() => {
        if (!cstate?.enabled) return null;
        if (cstate.status === 'connected') return <div className="inline-banner" role="status"><ShieldCheck size={16} aria-hidden="true" /> Ready. Claude and ChatGPT can reach this browser while Chrome is open.</div>;
        if (cstate.status === 'connecting') return <div className="inline-banner" role="status">Connecting…</div>;
        return <div className="inline-banner inline-banner--error" role="alert">Can't reach the connector{cstate.error ? ` (${cstate.error})` : ''}. Check your internet connection; it retries every minute.</div>;
    })();

    const localStatus = (() => {
        if (!state?.enabled) return null;
        if (state.status === 'connected') return <div className="inline-banner" role="status"><ShieldCheck size={16} aria-hidden="true" /> Connected to the helper app{state.hostVersion ? ` ${state.hostVersion}` : ''}.</div>;
        if (state.status === 'connecting') return <div className="inline-banner" role="status">Connecting to the helper app…</div>;
        return (
            <div className="inline-banner inline-banner--error" role="alert">
                <span>Helper app not found{state.error ? ` (${state.error})` : ''}. Run <code>npx {PACKAGE_NAME} install</code> in a terminal, then turn this off and on.</span>
                <button type="button" className="btn btn--secondary" onClick={() => { void api.removePermission(); }}>Remove permission</button>
            </div>
        );
    })();

    const clients = state?.clients ?? [];

    return (
        <div className="main-content trash-view agents-view">
            <header className="main-header trash-header">
                <button className="back-button" onClick={onBack} title="Back to bookmarks" aria-label="Back to bookmarks">
                    <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <h2>{tabBar ? 'AI Tools' : 'Connect Claude or ChatGPT'}</h2>
            </header>
            {tabBar}
            <div className="trash-scroll">
                {readOnly ? (
                    <div className="inline-banner" role="note">Connections work in regular windows only.</div>
                ) : (
                    <>
                        <section className="connect-section" aria-labelledby="connect-online">
                            <h3 id="connect-online" className="ai-group-title"><Smartphone size={16} aria-hidden="true" /> Claude and ChatGPT apps</h3>
                            <label className="trash-switch">
                                <input type="checkbox" role="switch" checked={online} disabled={!cstate || connector.busy} onChange={e => { void toggleOnline(e.target.checked); }} />
                                <span className="trash-switch-text">
                                    <span className="trash-switch-title">Let Claude and ChatGPT organise my bookmarks</span>
                                    <span className="trash-switch-sub">Then ask from the Claude or ChatGPT app on any device, phone included, while Chrome is open on this computer. Requests pass through our relay, which keeps none of your bookmarks.</span>
                                </span>
                            </label>
                            {onlineStatus}

                            {online && cstate?.address && (
                                <>
                                    <ol className="connect-steps">
                                        <li>
                                            Copy this address:
                                            <div className="connect-address">
                                                <code>{cstate.address}</code>
                                                <button type="button" className="btn btn--primary" onClick={() => { void copy(cstate.address!, 'Address copied.'); }}><Copy size={16} aria-hidden="true" /> Copy</button>
                                            </div>
                                        </li>
                                        <li><strong>Claude:</strong> on claude.ai or the desktop app, open Settings, then Connectors, choose Add custom connector and paste the address. <strong>ChatGPT</strong> (Plus or Pro): in Settings, turn on developer mode, then create an app with the address.</li>
                                        <li>Sign in when asked, and type the code below.</li>
                                        <li>Done. Ask, for example: "Sort my Bookmarks bar into folders by topic".</li>
                                    </ol>
                                    {!invite && state?.inviteRetryAt && (
                                        <div className="inline-banner" role="status">Too many sign-in codes this hour. A new code shows here in {Math.max(1, Math.ceil((state.inviteRetryAt - now) / 60000))} min.</div>
                                    )}
                                    {invite && (
                                        <section className="connect-code-card" aria-label="Sign-in code" aria-live="polite">
                                            <div className="agents-prompt-head">
                                                <div>
                                                    <div className="trash-row-title">Sign-in code</div>
                                                    <div className="trash-row-meta">Changes in {Math.max(0, Math.ceil((invite.expiresAt - now) / 60000))} min</div>
                                                </div>
                                                <div className="agents-code" aria-label={`Code ${invite.code.split('').join(' ')}`}>{invite.code.slice(0, 3)} {invite.code.slice(3)}</div>
                                            </div>
                                            <FolderChecklist roots={roots} hiddenFolderIds={hiddenFolderIds} chosen={new Set(invite.folderIds)} onChange={(next) => { void api.setInviteGrant([...next], invite.stripQuery, invite.mode); }} legend="Folders it may use" />
                                            <ModeSelect id="invite-mode" label="What it may do" value={invite.mode} onChange={(m) => { void api.setInviteGrant(invite.folderIds, invite.stripQuery, m); }} />
                                            <label className="ai-check">
                                                <input type="checkbox" checked={invite.stripQuery} onChange={e => { void api.setInviteGrant(invite.folderIds, e.target.checked, invite.mode); }} />
                                                <span>Remove the part of links after "?"</span>
                                            </label>
                                        </section>
                                    )}
                                    <div className="connect-section">
                                        {confirmNewAddress ? (
                                            <div className="inline-banner" role="alert">
                                                <span>Make a new address? Apps connected with the old one stop working and must be added again.</span>
                                                <button type="button" className="btn btn--danger" onClick={() => { void connector.newAddress().then(() => { setConfirmNewAddress(false); toast('New address made.'); }); }}>Make a new address</button>
                                                <button type="button" className="btn btn--secondary" onClick={() => setConfirmNewAddress(false)}>Keep it</button>
                                            </div>
                                        ) : (
                                            <button type="button" className="btn btn--text" onClick={() => setConfirmNewAddress(true)}>Make a new address</button>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>

                        {prompt && (
                            <section className="agents-prompt" aria-label="Pairing request" aria-live="polite">
                                <div className="agents-prompt-head">
                                    <div>
                                        <div className="trash-row-title">"{prompt.name}" wants to connect</div>
                                        <div className="trash-row-meta">Asked {formatAgo(prompt.startedAt, now)} · ends in {Math.max(0, Math.ceil((prompt.expiresAt - now) / 1000))} s</div>
                                    </div>
                                    <div className="agents-code" aria-label={`Pairing code ${prompt.code.split('').join(' ')}`}>{prompt.code.slice(0, 3)} {prompt.code.slice(3)}</div>
                                </div>
                                <p className="modal-text">Choose what it may use, then type this code where it asks. If you did not ask for this, cancel.</p>
                                <FolderChecklist roots={roots} hiddenFolderIds={hiddenFolderIds} chosen={promptChosen} onChange={(next) => { void api.setPromptGrant([...next], prompt.stripQuery, prompt.mode); }} legend="Folders it may use" />
                                <ModeSelect id="prompt-mode" label="What it may do" value={prompt.mode} onChange={(m) => { void api.setPromptGrant(prompt.folderIds, prompt.stripQuery, m); }} />
                                <label className="ai-check">
                                    <input type="checkbox" checked={prompt.stripQuery} onChange={e => { void api.setPromptGrant(prompt.folderIds, e.target.checked, prompt.mode); }} />
                                    <span>Remove the part of links after "?"</span>
                                </label>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn--text" onClick={() => { void api.cancelPrompt(true); }}>Block for an hour</button>
                                    <button type="button" className="btn btn--secondary" onClick={() => { void api.cancelPrompt(false); }}>Cancel</button>
                                </div>
                            </section>
                        )}

                        {clients.length > 0 && (
                            <section className="connect-section" aria-label="Connected apps">
                                <h3 className="ai-group-title">Connected</h3>
                                <ul className="trash-list">
                                    {clients.map(c => (
                                        <li key={c.id} className="trash-row">
                                            <div className="trash-row-main">
                                                <div className="trash-row-text">
                                                    <div className="trash-row-title">{c.name}<span className="connect-badge">{c.transport === 'remote' ? 'online' : 'this computer'}</span></div>
                                                    <div className="trash-row-meta">
                                                        Added {formatAgo(c.pairedAt)}{c.lastUsedAt ? ` · used ${formatAgo(c.lastUsedAt)}` : ' · not used yet'} · {c.folderIds.length ? plural(c.folderIds.length, 'folder') : 'no folders shared'}
                                                    </div>
                                                </div>
                                                <div className="trash-row-actions">
                                                    <ModeSelect id={`mode-${c.id}`} label={`What ${c.name} may do`} value={c.mode} onChange={(m) => { void api.updateClient(c.id, { mode: m }); }} />
                                                    <button type="button" className="btn btn--secondary" onClick={() => setEditing({ id: c.id, name: c.name, chosen: new Set(c.folderIds), strip: c.stripQuery })}>Folders</button>
                                                    <button type="button" className="btn btn--text btn--danger-text" onClick={() => { void api.removeClient(c.id).then(() => toast(`Removed ${c.name}. It can no longer connect.`)); }}>Remove</button>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                {confirmRemoveAll ? (
                                    <div className="inline-banner" role="alert">
                                        <span>Remove every connected app? Each would have to connect again.</span>
                                        <button type="button" className="btn btn--danger" onClick={() => { void api.removeAll().then(() => { setConfirmRemoveAll(false); toast('All removed.'); }); }}>Remove all</button>
                                        <button type="button" className="btn btn--secondary" onClick={() => setConfirmRemoveAll(false)}>Keep them</button>
                                    </div>
                                ) : (
                                    <button type="button" className="btn btn--text btn--danger-text" onClick={() => setConfirmRemoveAll(true)}>Remove all</button>
                                )}
                            </section>
                        )}

                        <details className="connect-section">
                            <summary className="ai-group-title"><Laptop size={16} aria-hidden="true" /> Coding agents on this computer (Claude Code, Cursor, VS Code)</summary>
                            <label className="trash-switch">
                                <input type="checkbox" role="switch" checked={!!state?.enabled} disabled={!state || api.busy} onChange={e => { void toggleLocal(e.target.checked); }} />
                                <span className="trash-switch-text">
                                    <span className="trash-switch-title">Connect coding agents</span>
                                    <span className="trash-switch-sub">Works without the internet relay. Chrome asks to let the extension talk to a helper app on this computer. Turning this off removes that permission.</span>
                                </span>
                            </label>
                            {localStatus}
                            {state?.enabled && !prompt && (
                                <section className="agents-setup" aria-label="Set up">
                                    <ol>
                                        <li>
                                            In a terminal, add the helper (needs Node 22 or newer):
                                            <div className="agents-command">
                                                <code>{SETUP_COMMAND}</code>
                                                <button type="button" className="btn btn--secondary" onClick={() => { void copy(SETUP_COMMAND, 'Copied. Paste it into your terminal.'); }}><Copy size={16} aria-hidden="true" /> Copy</button>
                                            </div>
                                        </li>
                                        <li>Ask your agent: "pair with my bookmarks".</li>
                                        <li>A 6-digit code appears on this page. Choose the folders, then type the code into the agent.</li>
                                    </ol>
                                </section>
                            )}
                        </details>
                    </>
                )}
            </div>
            {editing && (
                <Modal
                    title={`Folders ${editing.name} may use`}
                    onClose={() => setEditing(null)}
                    className="modal--narrow"
                    footer={(
                        <div className="modal-actions">
                            <button type="button" className="btn btn--secondary" onClick={() => setEditing(null)}>Cancel</button>
                            <button type="button" className="btn btn--primary btn--grow" onClick={() => { void api.updateClient(editing.id, { folderIds: [...editing.chosen], stripQuery: editing.strip }).then(() => { setEditing(null); toast('Saved.'); }); }}>Save</button>
                        </div>
                    )}
                >
                    <div className="ai-dialog-body">
                        <FolderChecklist roots={roots} hiddenFolderIds={hiddenFolderIds} chosen={editing.chosen} onChange={(next) => setEditing({ ...editing, chosen: next })} legend="Folders it may use" />
                        <label className="ai-check">
                            <input type="checkbox" checked={editing.strip} onChange={e => setEditing({ ...editing, strip: e.target.checked })} />
                            <span>Remove the part of links after "?"</span>
                        </label>
                    </div>
                </Modal>
            )}
        </div>
    );
};
