// SPDX-License-Identifier: AGPL-3.0-only
//
// Ask AI (docs/designs/ai-assistant.md): tell the AI what to do with the
// bookmarks; it looks, then changes them at once, and every change card has Undo.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, RotateCcw, Send, Settings, Smartphone, Sparkles, Square } from 'lucide-react';
import type { AskAIApi, ChatItem } from '../popup/hooks/useAskAI';

interface Props {
    api: AskAIApi;
    onBack: () => void;
    onOpenSettings: () => void;
    onOpenConnect: () => void;
    onOpenActivity: () => void;
    onCopyPaste: () => void;
    readOnly: boolean;
    toast: (message: string, tone?: 'error') => void;
}

const SUGGESTIONS = [
    'Sort my Bookmarks bar into folders by topic',
    'Find duplicate bookmarks and send the extras to Trash',
    'Tag the bookmarks in Other bookmarks',
    'Give unclear bookmark titles clear names',
];

const Row: React.FC<{ item: ChatItem; onUndo: (id: string) => void; busyUndo: string | null }> = ({ item, onUndo, busyUndo }) => {
    switch (item.kind) {
        case 'user':
            return <div className="ask-row ask-row--user"><div className="ask-bubble">{item.text}</div></div>;
        case 'assistant':
            return <div className="ask-row"><div className="ask-text">{item.text}</div></div>;
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
        case 'changes':
            return (
                <div className={`ask-card${item.undone ? ' ask-card--undone' : ''}`}>
                    <div className="ask-card-main">
                        <div className="ask-card-title">{item.undone ? 'Undone: ' : ''}{item.title}</div>
                        <div className="ask-card-meta">{item.summary || 'Changes applied'}{item.skipped ? ` · ${item.skipped} skipped` : ''}</div>
                    </div>
                    {!item.undone && (
                        <button type="button" className="btn btn--secondary" disabled={busyUndo === item.changeSetId} onClick={() => onUndo(item.changeSetId)}>
                            <RotateCcw size={16} aria-hidden="true" /> Undo
                        </button>
                    )}
                </div>
            );
    }
};

export const AskAIView: React.FC<Props> = ({ api, onBack, onOpenSettings, onOpenConnect, onOpenActivity, onCopyPaste, readOnly, toast }) => {
    const [text, setText] = useState('');
    const [busyUndo, setBusyUndo] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const p = api.provider;

    useEffect(() => { api.reloadProvider(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [api.items.length, api.running]);

    const submit = (value = text) => {
        if (!value.trim() || api.running) return;
        api.send(value);
        setText('');
    };

    const undo = async (id: string) => {
        setBusyUndo(id);
        const r = await api.undo(id);
        setBusyUndo(null);
        if (!r.ok) toast(r.error ?? "Couldn't undo.", 'error');
        else toast(r.skipped ? `Undone. ${r.skipped} items changed since were left as they are.` : 'Undone.');
    };

    const notReady = p && !p.ready;

    return (
        <div className="main-content trash-view ask-view">
            <header className="main-header trash-header">
                <button className="back-button" onClick={onBack} title="Back to bookmarks" aria-label="Back to bookmarks">
                    <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <h2>Ask AI</h2>
                {api.items.length > 0 && !api.running && (
                    <button type="button" className="btn btn--text ask-new" onClick={api.clear}>New chat</button>
                )}
            </header>

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
                        <p>The AI looks through your bookmarks and makes the changes. Every change has Undo, and removed bookmarks go to Trash.</p>
                        <div className="ask-suggestions">
                            {SUGGESTIONS.map(s => (
                                <button key={s} type="button" className="ask-suggestion" onClick={() => submit(s)}>{s}</button>
                            ))}
                        </div>
                    </section>
                ) : (
                    <div className="ask-list">
                        {api.items.map((it, i) => <Row key={i} item={it} onUndo={(id) => { void undo(id); }} busyUndo={busyUndo} />)}
                        {api.running && <div className="ask-chip ask-chip--working" role="status"><span className="ai-tag-spinner" aria-hidden="true" /> Working…</div>}
                    </div>
                )}
            </div>

            {!readOnly && !notReady && (
                <form className="ask-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
                    <label className="visually-hidden" htmlFor="ask-input">Message</label>
                    <textarea
                        id="ask-input"
                        className="text-field ask-input"
                        rows={2}
                        placeholder="For example: move my recipe bookmarks into a Cooking folder"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                    />
                    <div className="ask-composer-row">
                        <span className="ask-disclosure">
                            {p ? `Titles, links and tags it reads go to ${p.label} (${p.model}).` : ''}{' '}
                            <button type="button" className="btn-link" onClick={onOpenActivity}>All AI changes</button>
                        </span>
                        {api.running ? (
                            <button type="button" className="btn btn--secondary" onClick={api.stop}><Square size={16} aria-hidden="true" /> Stop</button>
                        ) : (
                            <button type="submit" className="btn btn--primary" disabled={!text.trim()}><Send size={16} aria-hidden="true" /> Send</button>
                        )}
                    </div>
                </form>
            )}
        </div>
    );
};
