// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, Info, Trash2 } from 'lucide-react';
import { BookmarkPreview, FolderGlyph } from './BookmarkPreview';
import { EmptyTrashDialog } from './EmptyTrashDialog';
import { FolderPicker } from './FolderPicker';
import { entryPath, firstUrls, type TrashEntry, type TrashOperation, type TrashItem } from '../lib/trash_store';
import { formatAgo, formatIn, plural, truncateTitle } from '../lib/utils';
import type { TrashApi } from '../popup/hooks/useTrash';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface TrashViewProps {
    trash: TrashApi;
    /** Bookmark tree roots, for the "Restore to..." picker. */
    roots: Node[];
    onBack: () => void;
    /** Keep deletes made outside this extension (1.4.0). */
    keepExternal: boolean;
    onKeepExternalChange: (value: boolean) => void;
}

const PAGE = 50;

function entrySummary(e: TrashEntry): string {
    const title = truncateTitle(e.title, 60);
    const path = entryPath(e);
    const from = path ? `, from ${path}` : '';
    return e.isFolder ? `${title}, ${plural(e.bookmarkCount, 'bookmark')}${from}` : `${title}${from}`;
}

function operationSummary(op: TrashOperation): string {
    if (op.origin === 'duplicate-finder') return `${plural(op.items.length, 'duplicate')} removed by Duplicate Finder`;
    if (op.origin === 'external' && op.items.length > 1) {
        const paths = new Set(op.items.map(i => entryPath(i.entry)));
        const [only] = [...paths];
        return paths.size === 1 && only ? `${plural(op.items.length, 'item')} from ${only}` : plural(op.items.length, 'item');
    }
    if (op.items.length === 1) return entrySummary(op.items[0].entry);
    const paths = new Set(op.items.map(i => entryPath(i.entry)));
    const [only] = [...paths];
    return paths.size === 1 && only ? `${plural(op.items.length, 'item')} from ${only}` : plural(op.items.length, 'item');
}

/** Visible pending state: "Restoring...", an error, or nothing. */
function itemStatus(item: TrashItem): string | null {
    if (item.progress.state === 'restoring') return 'Restoring…';
    if (item.progress.state === 'failed') return item.progress.error ?? "Couldn't restore.";
    return null;
}

export const TrashView: React.FC<TrashViewProps> = ({ trash, roots, onBack, keepExternal, onKeepExternalChange }) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [shown, setShown] = useState(PAGE);
    const [picker, setPicker] = useState<{ operationId: string; entryId?: string; subject: string } | null>(null);
    const [pickerBusy, setPickerBusy] = useState(false);
    const [confirmEmpty, setConfirmEmpty] = useState(false);
    const [previews, setPreviews] = useState<Record<string, string>>({});

    const { operations, loading, loadError, busyOps, emptying, readOnly, badgeCount } = trash;
    const visibleOps = operations.slice(0, shown);

    // Expired entries go when Trash opens, not only on the daily alarm.
    useEffect(() => {
        void trash.purgeExpired();
        // Once per opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cached previews for the first three bookmarks of each visible row. The
    // stored record already holds a data: URL, so no object URLs to revoke.
    const wanted = [...new Set(visibleOps.flatMap(op => [
        ...op.items.flatMap(i => firstUrls(i.entry.tree, 3)).slice(0, 3),
        // Expanded rows show one preview per entry.
        ...(expanded.has(op.operationId) ? op.items.map(i => i.entry.tree.url).filter((u): u is string => !!u) : []),
    ]))];
    const wantedKey = wanted.join('\n');
    useEffect(() => {
        if (!wantedKey) return;
        let cancelled = false;
        const urls = wantedKey.split('\n');
        const load = async () => {
            const data = await chrome.storage.local.get(urls.map(u => `thumb_${u}`));
            if (cancelled) return;
            const next: Record<string, string> = {};
            for (const u of urls) {
                const rec = data[`thumb_${u}`] as { base64?: string } | undefined;
                if (rec?.base64?.startsWith('data:image/')) next[u] = rec.base64;
            }
            setPreviews(next);
        };
        load().catch(err => console.warn('[Trash] preview load failed', err));
        return () => { cancelled = true; };
    }, [wantedKey]);

    const toggle = (opId: string) => setExpanded(prev => {
        const s = new Set(prev);
        if (s.has(opId)) s.delete(opId); else s.add(opId);
        return s;
    });

    const pick = async (folderId: string) => {
        if (!picker) return;
        setPickerBusy(true);
        const target = picker.entryId
            ? { operationId: picker.operationId, entryId: picker.entryId }
            : { operationId: picker.operationId };
        await trash.restore(target, folderId);
        setPickerBusy(false);
        setPicker(null);
    };

    const header = (
        <header className="main-header trash-header">
            <button className="back-button" onClick={onBack} title="Back to bookmarks" aria-label="Back to bookmarks">
                <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <h2>Trash</h2>
            {operations.length > 0 && !readOnly && (
                <button type="button" className="btn btn--text btn--danger-text trash-empty-btn" onClick={() => setConfirmEmpty(true)} disabled={emptying}>
                    {emptying && <span className="btn-spinner" aria-hidden="true" />}
                    Empty Trash
                </button>
            )}
        </header>
    );

    let body: React.ReactNode;
    if (loading) {
        body = (
            <div className="trash-list" aria-busy="true" aria-label="Loading Trash">
                {[0, 1, 2].map(i => <div key={i} className="trash-row trash-row--skeleton"><span /><span /></div>)}
            </div>
        );
    } else if (loadError) {
        body = (
            <div className="inline-banner inline-banner--error" role="alert">
                <span>{loadError}</span>
                <button type="button" className="btn btn--secondary" onClick={trash.reload}>Retry</button>
            </div>
        );
    } else if (operations.length === 0) {
        body = (
            <div className="empty-state trash-empty">
                <Trash2 size={40} aria-hidden="true" className="trash-empty-icon" />
                <p>Nothing in Trash.</p>
                <p className="sub-text">
                    {keepExternal
                        ? "Bookmarks deleted here, in Chrome's bookmark manager or on your other devices stay here for 30 days."
                        : 'Bookmarks you delete in this extension stay here for 30 days.'}
                </p>
                <button type="button" className="btn btn--secondary" onClick={onBack}>Back to bookmarks</button>
            </div>
        );
    } else {
        body = (
            <ul className="trash-list">
                {visibleOps.map(op => {
                    const busy = busyOps.has(op.operationId) || op.items.some(i => i.progress.state === 'restoring');
                    const failed = op.items.filter(i => i.progress.state === 'failed');
                    const allNeedDestination = op.items.every(i => i.progress.needsDestination);
                    const firstError = failed.map(itemStatus).find(Boolean);
                    const isOpen = expanded.has(op.operationId);
                    const strip = op.items.flatMap(i => firstUrls(i.entry.tree, 3)).slice(0, 3);
                    const subject = op.items.length === 1 ? `'${truncateTitle(op.items[0].entry.title)}'` : plural(op.items.length, 'item');
                    let primaryLabel = op.items.length > 1 ? 'Restore all' : 'Restore';
                    if (failed.length) primaryLabel = 'Retry remaining';
                    if (busy) primaryLabel = 'Restoring…';
                    return (
                        <li key={op.operationId} className={`trash-row ${failed.length ? 'trash-row--failed' : ''}`}>
                            <div className="trash-row-main">
                                <div className="trash-strip" aria-hidden="true">
                                    {strip.length ? strip.map(u => (
                                        <span key={u} className="trash-strip-item">
                                            <BookmarkPreview url={u} title="" thumbnailUrl={previews[u]} variant="mini" />
                                        </span>
                                    )) : (
                                        <span className="trash-strip-item trash-strip-folder"><FolderGlyph size={20} /></span>
                                    )}
                                </div>
                                <div className="trash-row-text">
                                    <div className="trash-row-title">{operationSummary(op)}</div>
                                    <div className="trash-row-meta">
                                        {op.origin === 'external' && <span className="trash-source">Deleted outside this extension · </span>}
                                        Deleted {formatAgo(op.deletedAt)} · removed {formatIn(op.expiresAt)}
                                    </div>
                                    {firstError && <div className="trash-row-error" role="status">{firstError}</div>}
                                </div>
                                <div className="trash-row-actions">
                                    {allNeedDestination ? (
                                        <button type="button" className="btn btn--secondary" disabled={busy || readOnly}
                                            onClick={() => setPicker({ operationId: op.operationId, subject })}>
                                            Restore to…
                                        </button>
                                    ) : (
                                        <>
                                            <button type="button" className="btn btn--secondary" disabled={busy || readOnly}
                                                onClick={() => { void trash.restore({ operationId: op.operationId }); }}>
                                                {busy && <span className="btn-spinner" aria-hidden="true" />}
                                                {primaryLabel}
                                            </button>
                                            <button type="button" className="btn btn--text" disabled={busy || readOnly}
                                                onClick={() => setPicker({ operationId: op.operationId, subject })}>
                                                Restore to…
                                            </button>
                                        </>
                                    )}
                                    {op.items.length > 1 && (
                                        <button type="button" className="btn btn--icon" aria-expanded={isOpen}
                                            aria-label={`${isOpen ? 'Hide' : 'Show'} the ${op.items.length} items`}
                                            onClick={() => toggle(op.operationId)}>
                                            <ChevronDown size={18} aria-hidden="true" className={isOpen ? 'chev chev--open' : 'chev'} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            {isOpen && (
                                <ul className="trash-entries">
                                    {op.items.map(item => {
                                        const e = item.entry;
                                        const status = itemStatus(item);
                                        const url = e.tree.url;
                                        return (
                                            <li key={e.entryId} className="trash-entry">
                                                <span className="trash-entry-icon">
                                                    {url ? <BookmarkPreview url={url} title={e.title} thumbnailUrl={previews[url]} variant="mini" /> : <FolderGlyph size={18} />}
                                                </span>
                                                <span className="trash-entry-text">
                                                    <span className="trash-entry-title">{truncateTitle(e.title, 80)}{e.isFolder ? ` (${plural(e.bookmarkCount, 'bookmark')})` : ''}</span>
                                                    <span className="trash-entry-path">{entryPath(e)}</span>
                                                    {status && <span className="trash-entry-status">{status}</span>}
                                                </span>
                                                <button type="button" className="btn btn--text" disabled={busy || readOnly}
                                                    onClick={() => item.progress.needsDestination
                                                        ? setPicker({ operationId: op.operationId, entryId: e.entryId, subject: `'${truncateTitle(e.title)}'` })
                                                        : void trash.restore({ operationId: op.operationId, entryId: e.entryId })}>
                                                    {item.progress.needsDestination ? 'Restore to…' : 'Restore'}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </li>
                    );
                })}
                {operations.length > shown && (
                    <li className="trash-more">
                        <button type="button" className="btn btn--secondary" onClick={() => setShown(n => n + PAGE)}>
                            Show more ({operations.length - shown} left)
                        </button>
                    </li>
                )}
            </ul>
        );
    }

    return (
        <div className="main-content trash-view">
            {header}
            <div className="trash-scroll">
                <p className="trash-intro">Deleted bookmarks stay here for 30 days, then they are removed for good.</p>
                {!readOnly && (
                    <label className="trash-switch">
                        <input
                            type="checkbox"
                            role="switch"
                            checked={keepExternal}
                            onChange={e => onKeepExternalChange(e.target.checked)}
                        />
                        <span className="trash-switch-text">
                            <span className="trash-switch-title">Also keep bookmarks deleted outside this extension</span>
                            <span className="trash-switch-sub">
                                In Chrome's bookmark manager, by sync or on your other devices, while Chrome is open on this computer. Turning this off keeps what is already here.
                            </span>
                        </span>
                    </label>
                )}
                {readOnly && (
                    <div className="inline-banner" role="note">
                        <Info size={16} aria-hidden="true" />
                        <span>Trash works in regular windows only. Open this page in a normal window to restore or delete.</span>
                    </div>
                )}
                {body}
            </div>
            {confirmEmpty && (
                <EmptyTrashDialog
                    count={badgeCount}
                    busy={emptying}
                    onCancel={() => setConfirmEmpty(false)}
                    onConfirm={async () => { await trash.empty(); setConfirmEmpty(false); }}
                />
            )}
            {picker && (
                <FolderPicker
                    roots={roots}
                    subject={picker.subject}
                    busy={pickerBusy}
                    onCancel={() => setPicker(null)}
                    onPick={(id) => { void pick(id); }}
                />
            )}
        </div>
    );
};
