// SPDX-License-Identifier: AGPL-3.0-only
//
// Ask AI (docs/designs/ai-assistant.md): tell the AI what to do with the
// bookmarks; it looks, then changes them at once, and every change card has Undo.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CircleAlert, Folder, History, Images, Plus, Redo2, RotateCcw, Send, Settings, Smartphone, Sparkles, Square, Trash2, Undo2, X } from 'lucide-react';
import type { AskAIApi, AskContext, ChatItem } from '../popup/hooks/useAskAI';
import { dayLabel, timeLabel, type ChatSummary } from '../lib/agent/chat_store';
import { AskAIPreviews } from './AskAIPreviews';

interface Props {
    api: AskAIApi;
    /** page: the Ask AI tab of AI Tools; dock: the side panel beside the bookmarks (owner, 2026-11-10). */
    variant?: 'page' | 'dock';
    onBack: () => void;
    /** The AI Tools tab bar, shown under the header. */
    tabBar?: React.ReactNode;
    onOpenSettings: () => void;
    onOpenConnect: () => void;
    onOpenActivity: () => void;
    onCopyPaste: () => void;
    readOnly: boolean;
    toast: (message: string, tone?: 'error') => void;
    /** The folder open beside the dock; sent with each message while its chip is on. */
    context?: AskContext | null;
}

const SUGGESTIONS = [
    'Sort my Bookmarks bar into folders by topic',
    'Find duplicate bookmarks and send the extras to Trash',
    'Tag the bookmarks in Other bookmarks',
    'Give unclear bookmark titles clear names',
];

const Stamp: React.FC<{ at?: number }> = ({ at }) => (at ? <time className="ask-time" dateTime={new Date(at).toISOString()}>{timeLabel(at)}</time> : null);

interface RowActions {
    busy: string | null;
    onUndo: (id: string) => void;
    onRedo: (id: string) => void;
    onApprove: (id: string) => void;
    onDiscard: (id: string) => void;
}

// Model text is shown as plain text only (React escapes it); nothing it says becomes markup or a link.
const Row: React.FC<{ item: ChatItem; act: RowActions }> = ({ item, act }) => {
    switch (item.kind) {
        case 'user':
            return (
                <div className="ask-row ask-row--user">
                    <div className="ask-bubble ask-bubble--user">{item.text}</div>
                    {item.folder && <span className="ask-row-context"><Folder size={12} aria-hidden="true" /> {item.folder}</span>}
                    <Stamp at={item.at} />
                </div>
            );
        case 'assistant':
            return <div className="ask-row ask-row--ai"><div className="ask-bubble ask-bubble--ai">{item.text}</div><Stamp at={item.at} /></div>;
        case 'tool':
            return <div className={`ask-chip${item.failed ? ' ask-chip--failed' : ''}`}>{item.failed ? <CircleAlert size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{item.label}</div>;
        case 'error':
            return <div className="inline-banner inline-banner--error" role="alert">{item.text}</div>;
        case 'refused':
            return (
                <div className="ask-card ask-card--refused">
                    <div className="ask-card-title">Nothing changed: {item.title}</div>
                    <ul className="ai-refused">{item.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
            );
        case 'pending':
            return (
                <div className={`ask-card ask-card--pending${item.decided ? ' ask-card--undone' : ''}`} role="group" aria-label={`Waiting for your OK: ${item.title}`}>
                    <div className="ask-card-main">
                        <div className="ask-card-title">{item.decided === 'discarded' ? 'Not done: ' : item.decided === 'expired' ? 'Expired: ' : 'Needs your OK: '}{item.title}</div>
                        <div className="ask-card-meta">{item.summary || 'Changes'}. {item.decided ? 'Nothing was changed.' : 'Items go to Trash, where you can restore them for 30 days.'}</div>
                    </div>
                    {!item.decided && (
                        <div className="ask-card-actions">
                            <button type="button" className="btn btn--danger" disabled={act.busy === item.changeSetId} onClick={() => act.onApprove(item.changeSetId)}><Trash2 size={16} aria-hidden="true" /> Apply</button>
                            <button type="button" className="btn btn--secondary" disabled={act.busy === item.changeSetId} onClick={() => act.onDiscard(item.changeSetId)}>Don't</button>
                        </div>
                    )}
                </div>
            );
        case 'changes':
            return (
                <div className={`ask-card${item.undone ? ' ask-card--undone' : ''}`}>
                    <div className="ask-card-main">
                        <div className="ask-card-title">{item.undone ? 'Undone: ' : ''}{item.title}</div>
                        <div className="ask-card-meta">{item.summary || 'Changes applied'}{item.skipped ? ` · ${item.skipped} skipped` : ''}</div>
                    </div>
                    {item.undone ? (
                        <button type="button" className="btn btn--secondary" disabled={act.busy === item.changeSetId} onClick={() => act.onRedo(item.changeSetId)}>
                            <Redo2 size={16} aria-hidden="true" /> Redo
                        </button>
                    ) : (
                        <button type="button" className="btn btn--secondary" disabled={act.busy === item.changeSetId} onClick={() => act.onUndo(item.changeSetId)}>
                            <RotateCcw size={16} aria-hidden="true" /> Undo
                        </button>
                    )}
                </div>
            );
    }
};

/** Past chats, grouped by day, newest first. Deleting asks once, in place. */
const ChatsPanel: React.FC<{ api: AskAIApi; onPicked: () => void }> = ({ api, onPicked }) => {
    const [confirm, setConfirm] = useState<string | null>(null);
    const groups = useMemo(() => {
        const out: Array<{ day: string; list: ChatSummary[] }> = [];
        for (const c of api.chats) {
            const day = dayLabel(c.updatedAt);
            const g = out[out.length - 1];
            if (g && g.day === day) g.list.push(c); else out.push({ day, list: [c] });
        }
        return out;
    }, [api.chats]);
    if (!api.chats.length) return <div className="ask-prev-empty"><p>Your chats are kept on this device and listed here. Start one with a message.</p></div>;
    return (
        <div className="ask-chats">
            {groups.map(g => (
                <section key={g.day} aria-label={g.day}>
                    <h3 className="ask-chats-day">{g.day}</h3>
                    <ul className="ask-chats-list">
                        {g.list.map(c => (
                            <li key={c.id} className={`ask-chat-row${c.id === api.chatId ? ' ask-chat-row--active' : ''}`}>
                                {confirm === c.id ? (
                                    <div className="ask-chat-confirm" role="group" aria-label={`Delete ${c.title}?`}>
                                        <span>Delete this chat?</span>
                                        <button type="button" className="btn btn--danger btn--small" onClick={() => { api.removeChat(c.id); setConfirm(null); }}>Delete</button>
                                        <button type="button" className="btn btn--text btn--small" onClick={() => setConfirm(null)}>Keep</button>
                                    </div>
                                ) : (
                                    <>
                                        <button type="button" className="ask-chat-open" aria-current={c.id === api.chatId ? 'true' : undefined} disabled={api.running} onClick={() => { api.openChat(c.id); onPicked(); }}>
                                            <span className="ask-chat-title">{c.title}</span>
                                            <span className="ask-chat-meta">{timeLabel(c.updatedAt)}</span>
                                        </button>
                                        <button type="button" className="icon-btn ask-chat-delete" aria-label={`Delete chat: ${c.title}`} title="Delete chat" disabled={api.running && c.id === api.chatId} onClick={() => setConfirm(c.id)}>
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
            <div className="ask-chats-foot">
                {confirm === '*' ? (
                    <div className="ask-chat-confirm" role="group" aria-label="Delete all chats?">
                        <span>Delete all {api.chats.length} chats? This cannot be undone.</span>
                        <button type="button" className="btn btn--danger btn--small" onClick={() => { api.removeAllChats(); setConfirm(null); }}>Delete all</button>
                        <button type="button" className="btn btn--text btn--small" onClick={() => setConfirm(null)}>Keep</button>
                    </div>
                ) : (
                    <button type="button" className="btn btn--text btn--small" disabled={api.running} onClick={() => setConfirm('*')}>Delete all chats</button>
                )}
                <p className="ask-chats-note">Kept on this device only, never synced or included in backups. Up to 50 chats.</p>
            </div>
        </div>
    );
};

/** The model pill under the message box: lists every chat model the saved key can reach. */
const ModelPicker: React.FC<{ api: AskAIApi; disabled: boolean }> = ({ api, disabled }) => {
    const p = api.provider;
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<string[] | null>(null);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
    const box = useRef<HTMLDivElement>(null);
    const cacheFor = useRef('');

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [open]);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        setQ('');
        const id = p?.cloud?.provider ?? '';
        if (next && (cacheFor.current !== id || !models)) {
            cacheFor.current = id;
            setModels(null);
            setError('');
            api.listModels().then(setModels).catch((e: unknown) => { setModels([]); setError(e instanceof Error ? e.message : 'Could not load the models.'); });
        }
    };
    if (!p?.ready) return null;
    const term = q.trim().toLowerCase();
    const shown = (models ?? []).filter(m => !term || m.toLowerCase().includes(term)).slice(0, 200);
    const typed = q.trim();
    const canUseTyped = typed && /^[\w.:/@+-]{1,200}$/.test(typed) && !(models ?? []).includes(typed);
    const pick = (m: string) => { api.setModel(m); setOpen(false); };
    return (
        <div className="ask-model" ref={box}>
            <button type="button" className="ask-model-pill" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle} title="Choose the model for Ask AI">
                <span className="ask-model-name">{p.model}</span>
                <ChevronDown size={14} aria-hidden="true" />
            </button>
            {open && (
                <div className="ask-model-pop" role="dialog" aria-label="Choose a model">
                    <label className="visually-hidden" htmlFor="ask-model-search">Search models</label>
                    <input id="ask-model-search" className="text-field" placeholder={`Search ${p.label} models`} value={q} onChange={e => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
                    <ul className="ask-model-list" role="listbox" aria-label={`${p.label} models`}>
                        {p.defaultModel && (
                            <li role="option" aria-selected={p.model === p.defaultModel}>
                                <button type="button" onClick={() => pick(p.defaultModel!)}>
                                    <span>{p.defaultModel}</span><span className="ask-model-note">Provider Settings model</span>
                                </button>
                            </li>
                        )}
                        {canUseTyped && <li role="option" aria-selected={false}><button type="button" onClick={() => pick(typed)}>Use "{typed}"</button></li>}
                        {models === null && <li className="ask-model-status" role="status"><span className="ai-tag-spinner" aria-hidden="true" /> Loading models…</li>}
                        {shown.filter(m => m !== p.defaultModel).map(m => (
                            <li key={m} role="option" aria-selected={p.model === m}>
                                <button type="button" onClick={() => pick(m)}>{m}{p.model === m && <Check size={14} aria-hidden="true" />}</button>
                            </li>
                        ))}
                        {models !== null && !shown.length && !canUseTyped && <li className="ask-model-status">{error || 'No models match.'}</li>}
                    </ul>
                    <p className="ask-model-foot">Applies to Ask AI only. Auto-Tag and Smart Search keep {p.defaultModel ?? 'the Provider Settings model'}. The model must support tools.</p>
                </div>
            )}
        </div>
    );
};

export const AskAIView: React.FC<Props> = ({ api, variant = 'page', onBack, tabBar, onOpenSettings, onOpenConnect, onOpenActivity, onCopyPaste, readOnly, toast, context }) => {
    const [text, setText] = useState('');
    // On by default; turning it off holds until another folder is opened.
    const [contextOffFor, setContextOffFor] = useState<string | null>(null);
    const useFolder = !!context && contextOffFor !== context.folderId;
    const folderName = context?.path.split(' > ').pop() ?? '';
    const [busy, setBusy] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const p = api.provider;
    const dock = variant === 'dock';

    useEffect(() => { api.reloadProvider(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [api.items.length, api.running]);

    const submit = (value = text) => {
        if (!value.trim() || api.running) return;
        api.send(value, useFolder ? context : null);
        setText('');
    };

    const run = async (id: string, job: () => Promise<{ ok: boolean; error?: string }>, done: string, fail: string) => {
        setBusy(id);
        const r = await job();
        setBusy(null);
        if (!r.ok) toast(r.error ?? fail, 'error'); else toast(done);
    };
    const act: RowActions = {
        busy,
        onUndo: (id) => { void run(id, () => api.undo(id), 'Undone. Redo puts it back.', "Couldn't undo."); },
        onRedo: (id) => { void run(id, () => api.redo(id), 'Done again.', "Couldn't redo."); },
        onApprove: (id) => { void run(id, () => api.approve(id), 'Applied. Undo puts everything back.', "Couldn't apply."); },
        onDiscard: (id) => { void run(id, () => api.discard(id), 'Nothing was changed.', "Couldn't cancel."); },
    };

    // The newest change in this chat, for the header's Undo and Redo.
    const last = [...api.items].reverse().find((i): i is Extract<ChatItem, { kind: 'changes' }> => i.kind === 'changes');

    const notReady = p && !p.ready;
    const [side, setSide] = useState<'previews' | 'chats'>(dock ? 'chats' : 'previews');
    const [sideOpen, setSideOpen] = useState(false);
    const openSide = (which: 'previews' | 'chats') => { setSide(which); setSideOpen(true); };

    // A divider whenever the day changes, so times read in context.
    const rows: React.ReactNode[] = [];
    let lastDay = '';
    api.items.forEach((it, i) => {
        if (it.at) {
            const d = dayLabel(it.at);
            if (d !== lastDay) { rows.push(<div key={`d${i}`} className="ask-day" role="separator">{d}</div>); lastDay = d; }
        }
        rows.push(<Row key={i} item={it} act={act} />);
    });

    const undoRedo = last && (
        <div className="ask-undo-redo" role="group" aria-label="Undo or redo the latest AI change">
            <button type="button" className="btn btn--secondary" disabled={!!last.undone || busy === last.changeSetId || api.running} onClick={() => act.onUndo(last.changeSetId)} title={`Undo: ${last.title}`}>
                <Undo2 size={16} aria-hidden="true" /> Undo
            </button>
            <button type="button" className="btn btn--secondary" disabled={!last.undone || busy === last.changeSetId || api.running} onClick={() => act.onRedo(last.changeSetId)} title={`Redo: ${last.title}`}>
                <Redo2 size={16} aria-hidden="true" /> Redo
            </button>
        </div>
    );

    const conversation = (
        <div className="trash-scroll ask-scroll" ref={listRef} aria-live="polite">
            {readOnly ? (
                <div className="inline-banner" role="note">Ask AI works in regular windows only.</div>
            ) : notReady ? (
                <section className="ask-empty">
                    <Sparkles size={28} className="ask-empty-icon" aria-hidden="true" />
                    <h3>Tell AI how to organise your bookmarks</h3>
                    <p>{p.problem} Ask AI uses your own key from OpenAI, Anthropic, Google Gemini, Groq, Mistral and others, or a local Ollama.</p>
                    <button type="button" className="btn btn--primary btn--grow" onClick={onOpenSettings}><Settings size={16} aria-hidden="true" /> Set up an AI provider</button>
                    <button type="button" className="btn btn--secondary btn--grow" onClick={onOpenConnect}><Smartphone size={16} aria-hidden="true" /> Use Claude or ChatGPT instead</button>
                    <button type="button" className="btn btn--text" onClick={onCopyPaste}>Other ways: copy and paste</button>
                </section>
            ) : api.items.length === 0 ? (
                <section className="ask-empty">
                    <Sparkles size={28} className="ask-empty-icon" aria-hidden="true" />
                    <h3>What should change?</h3>
                    <p>The AI looks through your bookmarks and makes the changes. Every change has Undo. Sending items to Trash waits for your OK.</p>
                    <div className="ask-suggestions">
                        {SUGGESTIONS.map(s => (
                            <button key={s} type="button" className="ask-suggestion" onClick={() => submit(s)}>{s}</button>
                        ))}
                    </div>
                </section>
            ) : (
                <div className="ask-list">
                    {rows}
                    {api.running && <div className="ask-chip ask-chip--working" role="status"><span className="ai-tag-spinner" aria-hidden="true" /> Working…</div>}
                </div>
            )}
        </div>
    );

    const composer = !readOnly && !notReady && (
        <form className="ask-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
            {context && (
                <button
                    type="button"
                    className={`ask-context${useFolder ? '' : ' ask-context--off'}`}
                    aria-pressed={useFolder}
                    aria-label={`Open folder ${folderName} ${useFolder ? 'included' : 'not included'}`}
                    title={useFolder ? 'The AI knows which folder is open. Click to leave it out.' : 'Click to tell the AI which folder is open.'}
                    onClick={() => setContextOffFor(useFolder ? context.folderId : null)}
                >
                    <Folder size={14} aria-hidden="true" />
                    <span className="ask-context-name">{folderName}</span>
                    <span className="ask-context-state">{useFolder ? 'included' : 'not included'}</span>
                </button>
            )}
            <label className="visually-hidden" htmlFor={dock ? 'ask-input-dock' : 'ask-input'}>Message</label>
            <textarea
                id={dock ? 'ask-input-dock' : 'ask-input'}
                className="text-field ask-input"
                rows={2}
                maxLength={4000}
                placeholder="For example: move my recipe bookmarks into a Cooking folder"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            />
            <div className="ask-composer-row">
                <ModelPicker api={api} disabled={api.running} />
                {api.running ? (
                    <button type="button" className="btn btn--secondary" onClick={api.stop}><Square size={16} aria-hidden="true" /> Stop</button>
                ) : (
                    <button type="submit" className="btn btn--primary" disabled={!text.trim()}><Send size={16} aria-hidden="true" /> Send</button>
                )}
            </div>
            <span className="ask-disclosure">
                {p ? `Titles, links and tags it reads go to ${p.label} (${p.model})${p.host ? ` at ${p.host}` : ''}.` : ''}{' '}
                <button type="button" className="btn-link" onClick={onOpenActivity}>All AI changes</button>
            </span>
        </form>
    );

    if (dock) {
        const showingChats = side === 'chats' && sideOpen;
        return (
            <aside className="ask-dock" aria-label="Ask AI">
                <header className="ask-dock-head">
                    <Sparkles size={18} className="ask-empty-icon" aria-hidden="true" />
                    <h2>Ask AI</h2>
                    <div className="ask-head-actions">
                        {!readOnly && (
                            <button type="button" className={`icon-btn${showingChats ? ' icon-btn--on' : ''}`} aria-pressed={showingChats} aria-label="Chats" title="Chats" onClick={() => (showingChats ? setSideOpen(false) : openSide('chats'))}>
                                <History size={18} aria-hidden="true" />
                            </button>
                        )}
                        {!readOnly && (
                            <button type="button" className="icon-btn" aria-label="New chat" title="New chat" disabled={api.running || api.items.length === 0} onClick={() => { api.clear(); setSideOpen(false); }}>
                                <Plus size={18} aria-hidden="true" />
                            </button>
                        )}
                        <button type="button" className="icon-btn" aria-label="Close Ask AI" title="Close" onClick={onBack}>
                            <X size={18} aria-hidden="true" />
                        </button>
                    </div>
                </header>
                {!showingChats && undoRedo && <div className="ask-dock-bar">{undoRedo}</div>}
                {showingChats ? (
                    <div className="ask-side-body"><ChatsPanel api={api} onPicked={() => setSideOpen(false)} /></div>
                ) : (
                    <>
                        {conversation}
                        {composer}
                    </>
                )}
            </aside>
        );
    }

    return (
        <div className="main-content trash-view ask-view">
            <header className="main-header trash-header">
                <button className="back-button" onClick={onBack} title="Back to bookmarks" aria-label="Back to bookmarks">
                    <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <h2>{tabBar ? 'AI Tools' : 'Ask AI'}</h2>
                {!readOnly && (
                    <div className="ask-head-actions">
                        {undoRedo}
                        <button type="button" className="btn btn--text ask-side-toggle" onClick={() => openSide('previews')}><Images size={16} aria-hidden="true" /> Previews</button>
                        <button type="button" className="btn btn--text ask-side-toggle" onClick={() => openSide('chats')}><History size={16} aria-hidden="true" /> Chats</button>
                        {api.items.length > 0 && !api.running && (
                            <button type="button" className="btn btn--text" onClick={api.clear}><Plus size={16} aria-hidden="true" /> New chat</button>
                        )}
                    </div>
                )}
            </header>
            {tabBar}

            <div className="ask-layout">
                <div className="ask-main">
                    {conversation}
                    {composer}
                </div>

                {!readOnly && (
                    <aside className={`ask-side${sideOpen ? ' ask-side--open' : ''}`} aria-label={side === 'chats' ? 'Chats' : 'Previews'}>
                        <div className="ask-side-head">
                            <div className="ask-seg" role="group" aria-label="Side panel">
                                <button type="button" aria-pressed={side === 'previews'} className={side === 'previews' ? 'is-on' : ''} onClick={() => setSide('previews')}><Images size={14} aria-hidden="true" /> Previews</button>
                                <button type="button" aria-pressed={side === 'chats'} className={side === 'chats' ? 'is-on' : ''} onClick={() => setSide('chats')}><History size={14} aria-hidden="true" /> Chats</button>
                            </div>
                            <button type="button" className="icon-btn ask-side-close" aria-label="Close panel" onClick={() => setSideOpen(false)}><X size={18} aria-hidden="true" /></button>
                        </div>
                        <div className="ask-side-body">
                            {side === 'chats' ? <ChatsPanel api={api} onPicked={() => setSideOpen(false)} /> : <AskAIPreviews items={api.items} />}
                        </div>
                    </aside>
                )}
            </div>
        </div>
    );
};
