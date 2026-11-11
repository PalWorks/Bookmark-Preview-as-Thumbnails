// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { MoreVertical, Trash2 } from 'lucide-react';
import './ThumbnailTile.css';
import { BookmarkPreview } from '../../components/BookmarkPreview';

interface BookmarkItem {
    id: string;
    url: string;
    title: string;
    thumbnailUrl?: string;
}

interface ThumbnailTileProps {
    bookmark: BookmarkItem;
    isLoading?: boolean;
    isQueued?: boolean;
    tags?: string[];
    onContextMenu?: (e: React.MouseEvent) => void;
    onDelete?: () => void;
    /** A delete for this bookmark is in flight. */
    deleting?: boolean;
    canDelete?: boolean;
    /** Selection checkbox (1.4.0), rendered top-left. */
    selectBox?: React.ReactNode;
    selected?: boolean;
    /** The link was opened (click, middle-click). */
    onOpened?: () => void;
    onOpenedAux?: (e: React.MouseEvent) => void;
}

/**
 * Grid card. The title link stretches over the whole card (one tab stop that
 * opens the page); the delete and more-options buttons sit above it. Middle-click
 * and Ctrl+click open in a background tab natively.
 */
const ThumbnailTile: React.FC<ThumbnailTileProps> = ({
    bookmark, isLoading, isQueued, tags, onContextMenu, onDelete, deleting = false, canDelete = true,
    selectBox, selected = false, onOpened, onOpenedAux,
}) => {
    const title = bookmark.title || bookmark.url;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Delete' && onDelete && canDelete && !deleting) {
            e.preventDefault();
            onDelete();
        }
    };

    return (
        <div
            className={`tile ${deleting ? 'tile--busy' : ''} ${selected ? 'is-selected' : ''}`}
            data-node-id={bookmark.id}
            onContextMenu={onContextMenu}
            onKeyDown={handleKeyDown}
        >
            {selectBox}
            <div className="preview">
                <BookmarkPreview url={bookmark.url} title={title} thumbnailUrl={bookmark.thumbnailUrl} variant="tile" />
                {isLoading && (
                    <div className="loading-overlay">
                        <div className="loading-bar"></div>
                    </div>
                )}
                {isQueued && !isLoading && (
                    <div className="queued-overlay">
                        <span className="queued-text">Waiting…</span>
                    </div>
                )}
            </div>
            <div className="info">
                <a
                    className="tile-title tile-link"
                    href={bookmark.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={title}
                    onClick={onOpened}
                    onAuxClick={onOpenedAux}
                >
                    {title}
                </a>
                <div className="tile-url" title={bookmark.url}>
                    {bookmark.url}
                </div>
                {tags && tags.length > 0 && (
                    <div className="tile-tags">
                        {tags.map(tag => (
                            <span key={tag} className="tile-tag">{tag}</span>
                        ))}
                    </div>
                )}
            </div>
            <div className="tile-actions">
                <button
                    type="button"
                    className="tile-action-btn more-options-btn"
                    aria-label={`More actions for ${title}`}
                    aria-haspopup="menu"
                    title="More actions"
                    onClick={(e) => { e.stopPropagation(); onContextMenu?.(e); }}
                >
                    <MoreVertical size={18} aria-hidden="true" />
                </button>
                {onDelete && (
                    <button
                        type="button"
                        className="tile-action-btn tile-delete-btn"
                        aria-label={`Delete ${title}`}
                        title={canDelete ? 'Delete (you can undo)' : 'Delete works in regular windows only'}
                        disabled={!canDelete || deleting}
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    >
                        {deleting ? <span className="btn-spinner" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
                    </button>
                )}
            </div>
        </div>
    );
};

export default ThumbnailTile;
