// SPDX-License-Identifier: AGPL-3.0-only
//
// Settings > Coding agents (docs/designs/agent-bridge.md, Stage 2): the switch,
// the pairing prompt, and the paired agents with their folders and permission.

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Plug, ShieldCheck } from 'lucide-react';
import { FolderChecklist } from './FolderChecklist';
import { Modal } from './Modal';
import type { BridgeApi } from '../popup/hooks/useBridge';
import { PACKAGE_NAME, SETUP_COMMAND } from '../lib/bridge/protocol';
import { formatAgo, plural } from '../lib/utils';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface Props {
    api: BridgeApi;
    roots: Node[];
    hiddenFolderIds: Set<string>;
    onBack: () => void;
    readOnly: boolean;
    toast: (message: string, tone?: 'error') => void;
}

function useNow(active: boolean): number {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setT(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    return t;
}

export const AgentsView: React.FC<Props> = ({ api, roots, hiddenFolderIds, onBack, readOnly, toast }) => {
    const { state } = api;
    const [editing, setEditing] = useState<{ id: string; name: string; chosen: Set<string>; strip: boolean } | null>(null);
    const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
    const prompt = state?.prompt;
    const now = useNow(!!prompt);
    const promptChosen = new Set(prompt?.folderIds ?? []);

    const toggle = async (on: boolean) => {
        const res = await api.setEnabled(on);
        if (!res.ok) toast(res.error ?? "Couldn't change that.", 'error');
    };

    const copySetup = async () => {
        try { await navigator.clipboard.writeText(SETUP_COMMAND); toast('Copied. Paste it into your terminal.'); }
        catch { toast("Couldn't copy. Select the command and copy it yourself.", 'error'); }
    };

    const status = (() => {
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

    return (
        <div className="main-content trash-view agents-view">
            <header className="main-header trash-header">
                <button className="back-button" onClick={onBack} title="Back to bookmarks" aria-label="Back to bookmarks">
                    <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <h2>Coding agents</h2>
            </header>
            <div className="trash-scroll">
                <p className="trash-intro">Let a coding agent on this computer (Claude Code, Cursor, VS Code) read the folders you choose and propose changes. You review every change in AI changes, and one click undoes it.</p>
                {readOnly ? (
                    <div className="inline-banner" role="note">Coding agents work in regular windows only.</div>
                ) : (
                    <>
                        <label className="trash-switch">
                            <input type="checkbox" role="switch" checked={!!state?.enabled} disabled={!state || api.busy} onChange={e => { void toggle(e.target.checked); }} />
                            <span className="trash-switch-text">
                                <span className="trash-switch-title">Connect coding agents</span>
                                <span className="trash-switch-sub">Chrome asks to let the extension talk to a helper app on this computer. Turning this off removes that permission and keeps your paired agents.</span>
                            </span>
                        </label>
                        {status}

                        {state?.enabled && state.clients.length === 0 && !prompt && (
                            <section className="agents-setup" aria-label="Set up">
                                <h3 className="ai-group-title"><Plug size={16} aria-hidden="true" /> Set up in three steps</h3>
                                <ol>
                                    <li>
                                        In a terminal, add the helper (needs Node 22 or newer):
                                        <div className="agents-command">
                                            <code>{SETUP_COMMAND}</code>
                                            <button type="button" className="btn btn--secondary" onClick={() => { void copySetup(); }}><Copy size={16} aria-hidden="true" /> Copy</button>
                                        </div>
                                    </li>
                                    <li>Ask your agent: "pair with my bookmarks".</li>
                                    <li>A 6-digit code appears here. Choose the folders it may read, then type the code into the agent.</li>
                                </ol>
                            </section>
                        )}

                        {prompt && (
                            <section className="agents-prompt" aria-label="Pairing request" aria-live="polite">
                                <div className="agents-prompt-head">
                                    <div>
                                        <div className="trash-row-title">An agent that says it is "{prompt.name}" wants to connect</div>
                                        <div className="trash-row-meta">Asked {formatAgo(prompt.startedAt, now)} · ends in {Math.max(0, Math.ceil((prompt.expiresAt - now) / 1000))} s</div>
                                    </div>
                                    <div className="agents-code" aria-label={`Pairing code ${prompt.code.split('').join(' ')}`}>{prompt.code.slice(0, 3)} {prompt.code.slice(3)}</div>
                                </div>
                                <p className="modal-text">Choose what it may read, then type this code into the agent. If you did not ask for this, cancel.</p>
                                <FolderChecklist roots={roots} hiddenFolderIds={hiddenFolderIds} chosen={promptChosen} onChange={(next) => { void api.setPromptGrant([...next], prompt.stripQuery); }} legend="Folders it may read" />
                                <label className="ai-check">
                                    <input type="checkbox" checked={prompt.stripQuery} onChange={e => { void api.setPromptGrant(prompt.folderIds, e.target.checked); }} />
                                    <span>Remove the part of links after "?"</span>
                                </label>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn--text" onClick={() => { void api.cancelPrompt(true); }}>Block for an hour</button>
                                    <button type="button" className="btn btn--secondary" onClick={() => { void api.cancelPrompt(false); }}>Cancel</button>
                                </div>
                            </section>
                        )}

                        {state && state.clients.length > 0 && (
                            <section aria-label="Paired agents">
                                <h3 className="ai-group-title">Paired agents</h3>
                                <ul className="trash-list">
                                    {state.clients.map(c => (
                                        <li key={c.id} className="trash-row">
                                            <div className="trash-row-main">
                                                <div className="trash-row-text">
                                                    <div className="trash-row-title">{c.name}</div>
                                                    <div className="trash-row-meta">
                                                        Paired {formatAgo(c.pairedAt)}{c.lastUsedAt ? ` · used ${formatAgo(c.lastUsedAt)}` : ' · not used yet'} · {c.folderIds.length ? plural(c.folderIds.length, 'folder') : 'no folders shared'}
                                                    </div>
                                                </div>
                                                <div className="trash-row-actions">
                                                    <label className="visually-hidden" htmlFor={`mode-${c.id}`}>What {c.name} may do</label>
                                                    <select id={`mode-${c.id}`} className="text-field agents-mode" value={c.mode} onChange={e => { void api.updateClient(c.id, { mode: e.target.value as 'read' | 'propose' }); }}>
                                                        <option value="read">Read</option>
                                                        <option value="propose">Read and propose</option>
                                                    </select>
                                                    <button type="button" className="btn btn--secondary" onClick={() => setEditing({ id: c.id, name: c.name, chosen: new Set(c.folderIds), strip: c.stripQuery })}>Folders</button>
                                                    <button type="button" className="btn btn--text btn--danger-text" onClick={() => { void api.removeClient(c.id).then(() => toast(`Removed ${c.name}. It can no longer connect.`)); }}>Remove</button>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                {confirmRemoveAll ? (
                                    <div className="inline-banner" role="alert">
                                        <span>Remove every paired agent? Each would have to pair again.</span>
                                        <button type="button" className="btn btn--danger" onClick={() => { void api.removeAll().then(() => { setConfirmRemoveAll(false); toast('All agents removed.'); }); }}>Remove all</button>
                                        <button type="button" className="btn btn--secondary" onClick={() => setConfirmRemoveAll(false)}>Keep them</button>
                                    </div>
                                ) : (
                                    <button type="button" className="btn btn--text btn--danger-text" onClick={() => setConfirmRemoveAll(true)}>Remove all agents</button>
                                )}
                            </section>
                        )}
                    </>
                )}
            </div>
            {editing && (
                <Modal
                    title={`Folders ${editing.name} may read`}
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
                        <FolderChecklist roots={roots} hiddenFolderIds={hiddenFolderIds} chosen={editing.chosen} onChange={(next) => setEditing({ ...editing, chosen: next })} legend="Folders it may read" />
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
