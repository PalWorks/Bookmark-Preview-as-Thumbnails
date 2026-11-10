// SPDX-License-Identifier: AGPL-3.0-only
//
// AI changes: the review panel for a proposed change set and the Activity list
// of every set (pending, applied, undone, rejected, expired). Applying, Finish and
// Undo run in the worker (src/sw/change_sets.ts); this view only asks.

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, FolderPlus, ArrowRightLeft, PencilLine, Tag, Star, Trash2, Upload, Sparkles } from 'lucide-react';
import type { ChangeOp, OpKind } from '../lib/change_set/format';
import type { ChangeSetRecord, ChangeSetSummary, JournalItem, SetState } from '../sw/change_sets';
import type { ChangeSetsApi } from '../popup/hooks/useChangeSets';
import { formatAgo, plural, truncateTitle } from '../lib/utils';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface Props {
    api: ChangeSetsApi;
    roots: Node[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onBack: () => void;
    /** The AI Tools tab bar, shown under the header. */
    tabBar?: React.ReactNode;
    onOrganise: () => void;
    onAskAI?: () => void;
    onImport: () => void;
    readOnly: boolean;
    toast: (message: string, tone?: 'error') => void;
}

const KIND_LABEL: Record<OpKind, string> = {
    create_folder: 'New folders',
    move: 'Moves',
    rename: 'Renames',
    set_tags: 'Tags',
    set_rating: 'Ratings',
    trash: 'To Trash',
};

const KIND_ICON: Record<OpKind, React.ReactNode> = {
    create_folder: <FolderPlus size={16} aria-hidden="true" />,
    move: <ArrowRightLeft size={16} aria-hidden="true" />,
    rename: <PencilLine size={16} aria-hidden="true" />,
    set_tags: <Tag size={16} aria-hidden="true" />,
    set_rating: <Star size={16} aria-hidden="true" />,
    trash: <Trash2 size={16} aria-hidden="true" />,
};

const STATE_LABEL: Record<SetState, string> = {
    pending: 'Waiting for review',
    applying: 'Applying…',
    partly_applied: 'Partly applied',
    applied: 'Applied',
    rejected: 'Rejected',
    expired: 'Expired',
    undoing: 'Undoing…',
    partly_undone: 'Partly undone',
    undone: 'Undone',
};

const ITEM_LABEL: Record<JournalItem['state'], string> = {
    pending: 'Not applied yet',
    applying: 'Interrupted',
    done: 'Applied',
    skipped: 'Skipped',
    undoing: 'Undoing',
    undone: 'Undone',
    undo_skipped: 'Kept',
};

function nodeIndex(roots: Node[]) {
    const byId = new Map<string, Node>();
    const walk = (n: Node) => { byId.set(n.id, n); (n.children ?? []).forEach(walk); };
    roots.forEach(walk);
    const path = (id: string | undefined): string => {
        const parts: string[] = [];
        let cur = id ? byId.get(id) : undefined;
        let guard = 0;
        while (cur && cur.id !== '0' && guard++ < 64) { parts.unshift(cur.title || '(untitled)'); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
        return parts.join(' / ');
    };
    return { byId, path };
}

function summaryLine(s: ChangeSetSummary): string {
    const parts = (Object.entries(s.counts) as Array<[OpKind, number]>).map(([k, n]) => `${n} ${KIND_LABEL[k].toLowerCase()}`);
    return parts.join(', ');
}

export const AIChangesView: React.FC<Props> = ({ api, roots, selectedId, onSelect, onBack, tabBar, onOrganise, onAskAI, onImport, readOnly, toast }) => {
    const [detail, setDetail] = useState<{ set: ChangeSetRecord; items: JournalItem[] } | null>(null);
    const [ticked, setTicked] = useState<Set<number>>(new Set());
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    const idx = useMemo(() => nodeIndex(roots), [roots]);

    useEffect(() => {
        if (!selectedId) return;
        let live = true;
        void api.get(selectedId).then(d => {
            if (!live) return;
            setDetail(d);
            // Keep the user's ticks across refreshes of the same set.
            if (d && loadedFor !== selectedId) {
                setTicked(new Set(d.set.verdicts.filter(v => v.ok).map(v => v.n)));
                setLoadedFor(selectedId);
            }
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, api.version]);

    const describe = (op: ChangeOp, set: ChangeSetRecord): { title: string; before?: string; after?: string } => {
        const name = (id: string) => {
            if (id.startsWith('new:')) {
                const c = set.ops.find(o => o.op === 'create_folder' && o.tempId === id) as { title: string } | undefined;
                return c ? `new folder "${c.title}"` : id;
            }
            const n = idx.byId.get(id);
            return n ? (n.title || n.url || '(untitled)') : '(no longer here)';
        };
        switch (op.op) {
            case 'create_folder': return { title: op.title, after: `in ${op.parentId.startsWith('new:') ? name(op.parentId) : idx.path(op.parentId)}` };
            case 'move': return { title: name(op.id), before: idx.path(idx.byId.get(op.id)?.parentId), after: op.parentId.startsWith('new:') ? name(op.parentId) : idx.path(op.parentId) };
            case 'rename': return { title: name(op.id), before: idx.byId.get(op.id)?.title, after: op.title };
            case 'set_tags': return { title: name(op.id), after: op.tags.length ? op.tags.join(', ') : 'no tags' };
            case 'set_rating': return { title: name(op.id), after: op.rating === null ? 'no rating' : `${op.rating} of 5 stars` };
            case 'trash': {
                const n = idx.byId.get(op.id);
                // Everything inside goes with it: count the whole subtree recorded at validation.
                const n0 = set.ops.indexOf(op);
                const inside = Math.max(0, (set.verdicts[n0]?.baseline?.descendantIds?.length ?? 1) - 1);
                return { title: name(op.id), after: n && !n.url ? `folder and everything in it (${plural(inside, 'item')})` : idx.path(n?.parentId) };
            }
        }
    };

    const toggle = (set: ChangeSetRecord, n: number) => setTicked(prev => {
        const next = new Set(prev);
        const op = set.ops[n];
        if (next.has(n)) {
            next.delete(n);
            // Unticking a new folder unticks the moves into it.
            if (op.op === 'create_folder') set.verdicts.forEach(v => { if (v.dependsOn?.includes(n)) next.delete(v.n); });
        } else {
            next.add(n);
            set.verdicts[n].dependsOn?.forEach(d => next.add(d));
        }
        return next;
    });

    const headerBar = (
        <header className="main-header trash-header">
            <button className="back-button" onClick={selectedId ? () => onSelect(null) : onBack} title={selectedId ? 'Back to AI changes' : 'Back to bookmarks'} aria-label={selectedId ? 'Back to AI changes' : 'Back to bookmarks'}>
                <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <h2>{selectedId ? 'Review changes' : tabBar ? 'AI Tools' : 'AI changes'}</h2>
            {!selectedId && !readOnly && (
                <button type="button" className="btn btn--secondary trash-empty-btn" onClick={onImport}>
                    <Upload size={16} aria-hidden="true" /> Import changes
                </button>
            )}
        </header>
    );
    const header = (
        <>
            {headerBar}
            {!selectedId && tabBar}
        </>
    );

    if (selectedId) {
        if (!detail || detail.set.id !== selectedId) {
            return <div className="main-content trash-view">{header}<div className="trash-scroll" aria-busy="true"><div className="trash-row trash-row--skeleton"><span /><span /></div></div></div>;
        }
        const { set, items } = detail;
        const pending = set.state === 'pending';
        const busy = api.busyId === set.id || set.state === 'applying' || set.state === 'undoing';
        const itemFor = new Map(items.map(i => [i.n, i]));
        const kinds = [...new Set(set.order.map(n => set.ops[n].op))];
        const selectedCount = [...ticked].filter(n => set.verdicts[n]?.ok).length;
        const source = set.source.kind === 'file' ? `From file ${set.source.name ?? ''}` : set.source.kind === 'agent' ? `From ${set.source.name ?? 'a coding agent'}` : 'Pasted from an AI';

        const apply = async () => {
            const res = await api.apply(set.id, [...ticked]);
            if (!res.ok) toast(res.error ?? "Couldn't apply the changes.", 'error');
            else toast('Applied as one step. You can undo it from AI changes.');
        };
        const undo = async () => {
            const res = await api.undo(set.id);
            if (!res.ok) toast(res.error ?? "Couldn't undo.", 'error');
            else toast(res.skipped ? `Undone, except ${plural(res.skipped, 'item')} changed since.` : 'Undone.');
        };
        const finish = async () => {
            const res = await api.finish(set.id);
            if (!res.ok) toast(res.error ?? "Couldn't finish.", 'error');
        };
        const reject = async () => {
            const res = await api.reject(set.id);
            if (!res.ok) toast(res.error ?? "Couldn't reject.", 'error');
            else { toast('Rejected. Nothing was changed.'); onSelect(null); }
        };

        return (
            <div className="main-content trash-view ai-changes">
                {header}
                <div className="trash-scroll">
                    <div className="ai-set-head">
                        <Bot size={20} aria-hidden="true" />
                        <div>
                            <div className="trash-row-title">{set.title ? truncateTitle(set.title, 120) : 'Proposed changes'}</div>
                            <div className="trash-row-meta">{source} · {formatAgo(set.createdAt)}{set.scoped ? '' : ' · not tied to an export from this browser'}</div>
                        </div>
                        <span className={`ai-state ai-state--${set.state}`}>{STATE_LABEL[set.state]}</span>
                    </div>
                    {pending && <div className="inline-banner" role="note">Nothing has changed yet. Untick anything you disagree with, then apply.</div>}
                    {set.state === 'partly_applied' && <div className="inline-banner inline-banner--error" role="note">Applying stopped part-way. Finish the rest, or undo what was applied.</div>}
                    {!set.undoAvailable && <div className="inline-banner" role="note">Undo is no longer available for this change set.</div>}
                    {kinds.map(kind => (
                        <section key={kind} className="ai-group" aria-label={KIND_LABEL[kind]}>
                            <h3 className="ai-group-title">{KIND_ICON[kind]} {KIND_LABEL[kind]}</h3>
                            <ul className="ai-op-list">
                                {set.order.filter(n => set.ops[n].op === kind).map(n => {
                                    const d = describe(set.ops[n], set);
                                    const it = itemFor.get(n);
                                    const id = `op-${set.id}-${n}`;
                                    return (
                                        <li key={n} className={`ai-op ${it?.state === 'skipped' || it?.state === 'undo_skipped' ? 'ai-op--skipped' : ''}`}>
                                            {pending ? (
                                                <input id={id} type="checkbox" checked={ticked.has(n)} onChange={() => toggle(set, n)} disabled={busy} />
                                            ) : null}
                                            <label htmlFor={pending ? id : undefined} className="ai-op-text">
                                                <span className="ai-op-title">{truncateTitle(d.title, 80)}</span>
                                                <span className="ai-op-change">
                                                    {d.before !== undefined && <><span className="ai-before">{truncateTitle(d.before || '(top)', 60)}</span> → </>}
                                                    <span className="ai-after">{truncateTitle(d.after ?? '', 80)}</span>
                                                </span>
                                                {it && it.state !== 'pending' && <span className="ai-op-state">{ITEM_LABEL[it.state]}{it.reason ? `: ${it.reason}` : ''}</span>}
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
                {!readOnly && (
                    <div className="ai-actions">
                        {pending && (
                            <>
                                <button type="button" className="btn btn--secondary" onClick={() => { void reject(); }} disabled={busy}>Reject all</button>
                                <button type="button" className="btn btn--primary btn--grow" onClick={() => { void apply(); }} disabled={busy || selectedCount === 0}>
                                    {busy && <span className="btn-spinner" aria-hidden="true" />}
                                    <span>Apply {plural(selectedCount, 'change')}</span>
                                </button>
                            </>
                        )}
                        {set.state === 'partly_applied' && (
                            <button type="button" className="btn btn--secondary" onClick={() => { void finish(); }} disabled={busy}>Finish</button>
                        )}
                        {(set.state === 'applied' || set.state === 'partly_applied' || set.state === 'partly_undone') && set.undoAvailable && (
                            <button type="button" className="btn btn--primary btn--grow" onClick={() => { void undo(); }} disabled={busy}>
                                {busy && <span className="btn-spinner" aria-hidden="true" />}
                                <span>Undo</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    let body: React.ReactNode;
    if (api.loading) {
        body = <div className="trash-list" aria-busy="true">{[0, 1].map(i => <div key={i} className="trash-row trash-row--skeleton"><span /><span /></div>)}</div>;
    } else if (api.sets.length === 0) {
        body = (
            <div className="empty-state trash-empty">
                <Sparkles size={40} aria-hidden="true" className="trash-empty-icon" />
                <p>No AI changes yet.</p>
                <p className="sub-text">Changes made by Ask AI, Claude or ChatGPT show here, each with one-click Undo.</p>
                {!readOnly && onAskAI && <button type="button" className="btn btn--primary" onClick={onAskAI}>Ask AI</button>}
                {!readOnly && <button type="button" className="btn btn--text" onClick={onOrganise}>Other ways: copy and paste</button>}
            </div>
        );
    } else {
        body = (
            <ul className="trash-list">
                {api.sets.map(s => (
                    <li key={s.id} className="trash-row">
                        <div className="trash-row-main">
                            <div className="trash-row-text">
                                <div className="trash-row-title">{s.title ? truncateTitle(s.title, 90) : summaryLine(s)}</div>
                                <div className="trash-row-meta">
                                    {s.title ? `${summaryLine(s)} · ` : ''}{formatAgo(s.decidedAt ?? s.createdAt)}
                                    {s.outcome?.skipped ? ` · ${plural(s.outcome.skipped, 'change')} skipped` : ''}
                                    {!s.undoAvailable ? ' · Undo no longer available' : ''}
                                </div>
                            </div>
                            <span className={`ai-state ai-state--${s.state}`}>{STATE_LABEL[s.state]}</span>
                            <div className="trash-row-actions">
                                <button type="button" className={`btn ${s.state === 'pending' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => onSelect(s.id)}>
                                    {s.state === 'pending' ? 'Review' : 'Details'}
                                </button>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <div className="main-content trash-view ai-changes">
            {header}
            <div className="trash-scroll">
                <p className="trash-intro">Changes an AI proposed. Nothing happens until you apply them; applied changes can be undone here for 30 days.</p>
                {readOnly && <div className="inline-banner" role="note">AI changes work in regular windows only.</div>}
                {body}
            </div>
        </div>
    );
};
