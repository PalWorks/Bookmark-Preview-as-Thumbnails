// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { MoreVertical, ArrowLeft, Trash2, EyeOff, Star } from 'lucide-react';
import ThumbnailTile from '../popup/components/ThumbnailTile';
import { BookmarkPreview, FolderGlyph } from './BookmarkPreview';
import { countBookmarksDeep, plural } from '../lib/utils';
import type { FolderPrefs } from '../lib/folder_prefs';
import {
    LIST_COLUMN_LABELS, openedAt, formatDate, formatRelative, type ListColumn,
} from '../lib/list_columns';
import type { LinkMeta } from '../popup/hooks/useLinkMeta';
import type { HistoryStat } from '../popup/hooks/useHistoryStats';

type Node = chrome.bookmarks.BookmarkTreeNode & { dateLastUsed?: number };

export interface SelectionProps {
    active: boolean;
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    range: (id: string) => void;
}

interface MainContentProps {
    folder: Node | null;
    displayedNodes?: Node[];
    isSearching?: boolean;
    searchQuery?: string;
    thumbnails: Record<string, string>;
    loadingUrls: Set<string>;
    queuedUrls: Set<string>;
    bookmarkTags?: Record<string, string[]>;
    onNavigate: (id: string) => void;
    onNavigateBack?: () => void;
    viewMode: 'grid' | 'list';
    onContextMenu: (e: React.MouseEvent, node: Node) => void;
    onDelete: (node: Node) => void;
    canDelete: boolean;
    pendingDeleteIds: Set<string>;
    trashCount: number;
    onOpenTrash: () => void;
    /** 1.4.0: colours and hidden-from-search, selection, list columns. */
    folderPrefs?: FolderPrefs;
    selection?: SelectionProps;
    /** Replaces the header while items are selected. */
    selectionBar?: React.ReactNode;
    /** Shown in the header in list view. */
    columnsMenu?: React.ReactNode;
    listColumns?: ListColumn[];
    linkMeta?: Record<string, LinkMeta>;
    historyStats?: Record<string, HistoryStat>;
    historyLoading?: boolean;
    onRate?: (node: Node) => void;
    /** A bookmark link was opened from this page. */
    onOpened?: (url: string) => void;
    hiddenResultCount?: number;
    onShowHidden?: () => void;
}

const isPermanent = (n: Node) => !n.parentId || n.parentId === '0';

function ratingLabel(r?: number): string {
    return r ? `Rated ${r} of 5. Change rating` : 'Rate';
}

export const MainContent: React.FC<MainContentProps> = ({
    folder,
    displayedNodes,
    isSearching,
    searchQuery,
    thumbnails,
    loadingUrls,
    queuedUrls,
    bookmarkTags,
    onNavigate,
    onNavigateBack,
    viewMode,
    onContextMenu,
    onDelete,
    canDelete,
    pendingDeleteIds,
    trashCount,
    onOpenTrash,
    folderPrefs = {},
    selection,
    selectionBar,
    columnsMenu,
    listColumns = [],
    linkMeta = {},
    historyStats = {},
    historyLoading = false,
    onRate,
    onOpened,
    hiddenResultCount = 0,
    onShowHidden,
}) => {
    // Use displayedNodes if provided, otherwise fallback to folder.children (or empty)
    const nodesToDisplay = displayedNodes || folder?.children || [];

    if (!folder && !isSearching) return <div className="main-empty">Select a folder</div>;

    const showBackButton = !isSearching && folder && folder.parentId && folder.parentId !== '0';
    const selecting = !!selection?.active;

    // Delete key on a focused row or folder tile (grid bookmark tiles handle their own).
    const deleteOnKey = (node: Node) => (e: React.KeyboardEvent) => {
        if (e.key === 'Delete' && canDelete && !isPermanent(node) && !pendingDeleteIds.has(node.id)) {
            e.preventDefault();
            onDelete(node);
        }
    };

    const deleteButton = (node: Node, withLabel: boolean) => {
        const title = node.title || node.url || 'Untitled';
        const busy = pendingDeleteIds.has(node.id);
        return (
            <button
                type="button"
                className={`tile-action-btn tile-delete-btn ${withLabel ? 'tile-action-btn--label' : ''}`}
                aria-label={`Delete ${title}`}
                title={canDelete ? 'Delete (you can undo)' : 'Delete works in regular windows only'}
                disabled={!canDelete || busy}
                onClick={(e) => { e.stopPropagation(); onDelete(node); }}
            >
                {busy ? <span className="btn-spinner" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
                {withLabel && <span>Delete</span>}
            </button>
        );
    };

    const moreButton = (node: Node) => (
        <button
            type="button"
            className="tile-action-btn more-options-btn"
            aria-label={`More actions for ${node.title || node.url || 'Untitled'}`}
            aria-haspopup="menu"
            title="More actions"
            onClick={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
        >
            <MoreVertical size={18} aria-hidden="true" />
        </button>
    );

    /** Real checkbox: Space toggles, Shift+click or Shift+Space selects a range. */
    const selectBox = (node: Node) => {
        if (!selection) return null;
        const title = node.title || node.url || 'Untitled';
        const checked = selection.isSelected(node.id);
        return (
            <label className={`select-box ${checked ? 'select-box--on' : ''}`} onClick={e => e.stopPropagation()}>
                <input
                    type="checkbox"
                    aria-label={`Select ${title}`}
                    checked={checked}
                    onChange={() => { /* handled on click, which knows about Shift */ }}
                    onClick={(e) => {
                        if (e.shiftKey) selection.range(node.id); else selection.toggle(node.id);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === ' ' && e.shiftKey) { e.preventDefault(); selection.range(node.id); }
                    }}
                />
            </label>
        );
    };

    const hiddenIcon = (node: Node) => folderPrefs[node.id]?.hideFromSearch ? (
        <span className="hidden-search-icon" role="img" aria-label="Hidden from search" title="Hidden from search">
            <EyeOff size={14} aria-hidden="true" />
        </span>
    ) : null;

    const folderCount = (node: Node): number | undefined =>
        node.children ? countBookmarksDeep(node) : undefined;

    const opened = (node: Node) => () => { if (node.url) onOpened?.(node.url); };
    const openedAux = (node: Node) => (e: React.MouseEvent) => { if (e.button === 1 && node.url) onOpened?.(node.url); };

    // ── List columns ─────────────────────────────────────────────────────────
    const columnCell = (node: Node, col: ListColumn) => {
        const label = <span className="list-col-label">{LIST_COLUMN_LABELS[col]} </span>;
        const dash = (aria: string) => <span aria-label={aria} title={aria}>—</span>;
        const url = node.url;
        let content: React.ReactNode = null;
        switch (col) {
            case 'added':
                content = node.dateAdded ? formatDate(node.dateAdded) : dash('Unknown');
                break;
            case 'opened': {
                if (!url) { content = null; break; }
                const t = openedAt(node.dateLastUsed, linkMeta[url]?.lastOpenedAt);
                content = t
                    ? <span title={new Date(t).toLocaleString()}>{formatRelative(t)}</span>
                    : dash('Not opened yet from bookmarks');
                break;
            }
            case 'rating': {
                if (!url) { content = null; break; }
                const r = linkMeta[url]?.rating;
                content = (
                    <button type="button" className="rating-btn" aria-label={`${ratingLabel(r)} for ${node.title || url}`}
                        onClick={(e) => { e.stopPropagation(); onRate?.(node); }}>
                        {r ? (
                            <>
                                <span className="rating-stars" aria-hidden="true">
                                    {[1, 2, 3, 4, 5].map(n => <Star key={n} size={13} className={n <= r ? 'star-on' : 'star-off'} />)}
                                </span>
                                <span className="visually-hidden">{r} of 5</span>
                            </>
                        ) : <span>Rate</span>}
                    </button>
                );
                break;
            }
            case 'visits':
            case 'lastVisited': {
                if (!url) { content = null; break; }
                const s = historyStats[url];
                if (!s) content = historyLoading ? <span aria-label="Loading">…</span> : dash('Not in history');
                else if (col === 'visits') content = <span title="From Chrome's history on this device, this exact link">{s.visits}</span>;
                else content = s.lastVisit ? <span title={new Date(s.lastVisit).toLocaleString()}>{formatRelative(s.lastVisit)}</span> : dash('Not in history');
                break;
            }
        }
        if (content === null) return <span key={col} className={`list-col list-col--${col} list-col--empty`} />;
        return <span key={col} className={`list-col list-col--${col}`}>{col === 'rating' ? null : label}{content}</span>;
    };
    const columnCells = (node: Node) => listColumns.length > 0 && (
        <div className="list-cols">{listColumns.map(col => columnCell(node, col))}</div>
    );

    const allHidden = isSearching && nodesToDisplay.length === 0 && hiddenResultCount > 0;

    return (
        <div className={`main-content ${viewMode === 'list' ? 'list-view' : ''} ${selecting ? 'is-selecting' : ''}`}>
            {selecting && selectionBar ? selectionBar : (
                <header className="main-header">
                    {showBackButton && (
                        <button className="back-button" onClick={onNavigateBack} title="Go back" aria-label="Back to parent folder">
                            <ArrowLeft size={18} aria-hidden="true" />
                        </button>
                    )}
                    <h2>{isSearching ? `Search Results for "${searchQuery}"` : folder?.title}</h2>
                    {viewMode === 'list' && columnsMenu && <div className="main-header-end">{columnsMenu}</div>}
                </header>
            )}
            {isSearching && hiddenResultCount > 0 && !allHidden && (
                <p className="search-hidden-note">
                    {plural(hiddenResultCount, 'more match', 'more matches')} in folders hidden from search.{' '}
                    <button type="button" className="link-btn" onClick={onShowHidden}>Show them</button>
                </p>
            )}
            <div className={viewMode === 'grid' ? 'grid' : 'list-container'}>
                {nodesToDisplay.map((node) => {
                    const selected = selection?.isSelected(node.id) ?? false;
                    if (node.url) {
                        if (viewMode === 'list') {
                            const title = node.title || node.url;
                            return (
                                <div
                                    key={node.id}
                                    className={`list-item ${pendingDeleteIds.has(node.id) ? 'tile--busy' : ''} ${selected ? 'is-selected' : ''}`}
                                    data-node-id={node.id}
                                    onContextMenu={(e) => onContextMenu(e, node)}
                                    onKeyDown={deleteOnKey(node)}
                                >
                                    {selectBox(node)}
                                    <div className="list-item-thumb">
                                        <BookmarkPreview url={node.url} title={title} thumbnailUrl={thumbnails[node.url]} variant="row" />
                                    </div>
                                    <div className="list-item-info">
                                        <a href={node.url} target="_blank" rel="noopener noreferrer" className="list-item-title tile-link" title={title}
                                            onClick={opened(node)} onAuxClick={openedAux(node)}>
                                            {title}
                                        </a>
                                        <span className="list-item-url">{node.url}</span>
                                        {bookmarkTags?.[node.url]?.length ? (
                                            <div className="list-item-tags">
                                                {bookmarkTags[node.url].map(tag => (
                                                    <span key={tag} className="tile-tag">{tag}</span>
                                                ))}
                                            </div>
                                        ) : null}
                                        {columnCells(node)}
                                    </div>
                                    <div className="list-item-status">
                                        {loadingUrls.has(node.url) && <span className="status-loading">Loading...</span>}
                                        {queuedUrls.has(node.url) && <span className="status-queued">Waiting...</span>}
                                    </div>
                                    <div className="row-actions">
                                        {moreButton(node)}
                                        {deleteButton(node, true)}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <ThumbnailTile
                                key={node.id}
                                bookmark={{
                                    id: node.id,
                                    url: node.url,
                                    title: node.title,
                                    thumbnailUrl: thumbnails[node.url]
                                }}
                                isLoading={loadingUrls.has(node.url)}
                                isQueued={queuedUrls.has(node.url)}
                                tags={bookmarkTags?.[node.url]}
                                onContextMenu={(e) => onContextMenu(e, node)}
                                onDelete={() => onDelete(node)}
                                deleting={pendingDeleteIds.has(node.id)}
                                canDelete={canDelete}
                                selectBox={selectBox(node)}
                                selected={selected}
                                onOpened={opened(node)}
                                onOpenedAux={openedAux(node)}
                            />
                        );
                    }

                    // Folder
                    const count = folderCount(node);
                    const countLabel = count !== undefined ? `${plural(count, 'bookmark')}, including subfolders` : undefined;
                    const color = folderPrefs[node.id]?.color;
                    if (viewMode === 'list') {
                        return (
                            <div
                                key={node.id}
                                className={`list-item folder-list-item ${pendingDeleteIds.has(node.id) ? 'tile--busy' : ''} ${selected ? 'is-selected' : ''}`}
                                data-node-id={node.id}
                                onContextMenu={(e) => onContextMenu(e, node)}
                                onKeyDown={deleteOnKey(node)}
                            >
                                {!isPermanent(node) && selectBox(node)}
                                <FolderGlyph size={22} className="list-folder-icon" color={color} />
                                <div className="list-item-info">
                                    <span className="folder-title-line">
                                        <button type="button" className="list-item-title tile-link folder-link" onClick={() => onNavigate(node.id)} title={node.title}>
                                            {node.title || 'Untitled folder'}
                                        </button>
                                        {hiddenIcon(node)}
                                    </span>
                                    {columnCells(node)}
                                </div>
                                {count !== undefined && (
                                    <span className="folder-count-badge" title={countLabel} aria-label={countLabel}>{count}</span>
                                )}
                                <div className="row-actions">
                                    {moreButton(node)}
                                    {!isPermanent(node) && deleteButton(node, true)}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={node.id}
                            className={`folder-tile ${pendingDeleteIds.has(node.id) ? 'tile--busy' : ''} ${selected ? 'is-selected' : ''}`}
                            data-node-id={node.id}
                            onContextMenu={(e) => onContextMenu(e, node)}
                            onKeyDown={deleteOnKey(node)}
                        >
                            {!isPermanent(node) && selectBox(node)}
                            <FolderGlyph size={48} className="folder-icon" color={color} />
                            <span className="folder-title-line">
                                <button type="button" className="folder-label tile-link" onClick={() => onNavigate(node.id)} title={node.title}>
                                    {node.title || 'Untitled folder'}
                                </button>
                                {hiddenIcon(node)}
                            </span>
                            {count !== undefined && (
                                <span className="folder-tile-count" title={countLabel} aria-label={countLabel}>{plural(count, 'bookmark')}</span>
                            )}
                            <div className="tile-actions">
                                {moreButton(node)}
                                {!isPermanent(node) && deleteButton(node, false)}
                            </div>
                        </div>
                    );
                })}
                {nodesToDisplay.length === 0 && (
                    <div className="empty-state">
                        {allHidden ? (
                            <>
                                <p>{hiddenResultCount === 1
                                    ? 'The only match is in a folder hidden from search.'
                                    : `All ${hiddenResultCount} matches are in folders hidden from search.`}</p>
                                <p className="sub-text">
                                    <button type="button" className="link-btn" onClick={onShowHidden}>Show them</button>
                                </p>
                            </>
                        ) : isSearching ? (
                            <p>No matches.</p>
                        ) : (
                            <>
                                <p>This folder is empty.</p>
                                {trashCount > 0 ? (
                                    <p className="sub-text">
                                        Deleted items are in{' '}
                                        <button type="button" className="link-btn" onClick={onOpenTrash}>Trash ({trashCount})</button>.
                                    </p>
                                ) : (
                                    <p className="sub-text">Add bookmarks to see them here.</p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
