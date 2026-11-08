// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { MoreVertical, ArrowLeft, Trash2 } from 'lucide-react';
import ThumbnailTile from '../popup/components/ThumbnailTile';
import { BookmarkPreview, FolderGlyph } from './BookmarkPreview';
import { countBookmarksDeep, plural } from '../lib/utils';

type Node = chrome.bookmarks.BookmarkTreeNode;

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
}

const isPermanent = (n: Node) => !n.parentId || n.parentId === '0';

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
}) => {
    // Use displayedNodes if provided, otherwise fallback to folder.children (or empty)
    const nodesToDisplay = displayedNodes || folder?.children || [];

    if (!folder && !isSearching) return <div className="main-empty">Select a folder</div>;

    const showBackButton = !isSearching && folder && folder.parentId && folder.parentId !== '0';

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

    const folderCount = (node: Node): number | undefined =>
        node.children ? countBookmarksDeep(node) : undefined;

    return (
        <div className={`main-content ${viewMode === 'list' ? 'list-view' : ''}`}>
            <header className="main-header">
                {showBackButton && (
                    <button className="back-button" onClick={onNavigateBack} title="Go back" aria-label="Back to parent folder">
                        <ArrowLeft size={18} aria-hidden="true" />
                    </button>
                )}
                <h2>{isSearching ? `Search Results for "${searchQuery}"` : folder?.title}</h2>
            </header>
            <div className={viewMode === 'grid' ? 'grid' : 'list-container'}>
                {nodesToDisplay.map((node) => {
                    if (node.url) {
                        if (viewMode === 'list') {
                            const title = node.title || node.url;
                            return (
                                <div
                                    key={node.id}
                                    className={`list-item ${pendingDeleteIds.has(node.id) ? 'tile--busy' : ''}`}
                                    data-node-id={node.id}
                                    onContextMenu={(e) => onContextMenu(e, node)}
                                    onKeyDown={deleteOnKey(node)}
                                >
                                    <div className="list-item-thumb">
                                        <BookmarkPreview url={node.url} title={title} thumbnailUrl={thumbnails[node.url]} variant="row" />
                                    </div>
                                    <div className="list-item-info">
                                        <a href={node.url} target="_blank" rel="noopener noreferrer" className="list-item-title tile-link" title={title}>
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
                            />
                        );
                    }

                    // Folder
                    const count = folderCount(node);
                    const countLabel = count !== undefined ? `${plural(count, 'bookmark')}, including subfolders` : undefined;
                    if (viewMode === 'list') {
                        return (
                            <div
                                key={node.id}
                                className={`list-item folder-list-item ${pendingDeleteIds.has(node.id) ? 'tile--busy' : ''}`}
                                data-node-id={node.id}
                                onContextMenu={(e) => onContextMenu(e, node)}
                                onKeyDown={deleteOnKey(node)}
                            >
                                <FolderGlyph size={22} className="list-folder-icon" />
                                <button type="button" className="list-item-title tile-link folder-link" onClick={() => onNavigate(node.id)} title={node.title}>
                                    {node.title || 'Untitled folder'}
                                </button>
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
                            className={`folder-tile ${pendingDeleteIds.has(node.id) ? 'tile--busy' : ''}`}
                            data-node-id={node.id}
                            onContextMenu={(e) => onContextMenu(e, node)}
                            onKeyDown={deleteOnKey(node)}
                        >
                            <FolderGlyph size={48} className="folder-icon" />
                            <button type="button" className="folder-label tile-link" onClick={() => onNavigate(node.id)} title={node.title}>
                                {node.title || 'Untitled folder'}
                            </button>
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
                        {isSearching ? (
                            <p>No results found.</p>
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
