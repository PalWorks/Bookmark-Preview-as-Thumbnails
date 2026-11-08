// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState } from 'react';
import { ExternalLink, FolderInput, MoreHorizontal, Trash2, X } from 'lucide-react';
import { plural } from '../lib/utils';

/** Opening more tabs than this asks first, inside the bar. */
export const OPEN_CONFIRM_OVER = 20;

interface SelectionBarProps {
    count: number;
    /** Items in the view, for Select all. */
    total: number;
    /** Tabs Open would create (bookmarks, plus those directly inside selected folders). */
    openCount: number;
    canDelete: boolean;
    busy: 'move' | 'delete' | null;
    onOpen: () => void;
    onMove: () => void;
    onDelete: () => void;
    onSelectAll: () => void;
    onDone: () => void;
}

/**
 * Actions for the selected items. Desktop: replaces the folder header. Phones: a
 * bar fixed to the bottom (thumb zone) with Move to and Delete, the rest under More.
 */
export const SelectionBar: React.FC<SelectionBarProps> = ({
    count, total, openCount, canDelete, busy, onOpen, onMove, onDelete, onSelectAll, onDone,
}) => {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const none = count === 0;

    const open = () => {
        if (openCount > OPEN_CONFIRM_OVER) { setConfirmOpen(true); return; }
        onOpen();
    };

    if (confirmOpen) {
        return (
            <div className="selection-bar selection-bar--confirm" role="region" aria-label="Selection">
                <span className="selection-count">Open {plural(openCount, 'tab')}?</span>
                <div className="selection-actions">
                    <button type="button" className="btn btn--secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
                    <button type="button" className="btn btn--primary" autoFocus
                        onClick={() => { setConfirmOpen(false); onOpen(); }}>
                        Open {openCount}
                    </button>
                </div>
            </div>
        );
    }

    const secondary = (
        <>
            <button type="button" className="btn btn--text" onClick={open} disabled={none || openCount === 0}>
                <ExternalLink size={18} aria-hidden="true" /><span>Open</span>
            </button>
            <button type="button" className="btn btn--text" onClick={onSelectAll} disabled={count === total}>
                Select all
            </button>
        </>
    );

    return (
        <div className="selection-bar" role="region" aria-label="Selection">
            <span className="selection-count" role="status" aria-live="polite">
                {none ? 'Select items' : `${count} selected`}
            </span>
            <div className="selection-actions">
                <span className="selection-secondary">{secondary}</span>
                <button type="button" className="btn btn--secondary" onClick={onMove} disabled={none || busy !== null}>
                    {busy === 'move' ? <span className="btn-spinner" aria-hidden="true" /> : <FolderInput size={18} aria-hidden="true" />}
                    <span>Move to…</span>
                </button>
                <button type="button" className="btn btn--danger-outline" onClick={onDelete}
                    disabled={none || busy !== null || !canDelete}
                    title={canDelete ? 'Delete (you can undo)' : 'Delete works in regular windows only'}>
                    {busy === 'delete' ? <span className="btn-spinner" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
                    <span>Delete</span>
                </button>
                <button type="button" className="btn btn--icon selection-more" aria-label="More selection actions"
                    aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
                    <MoreHorizontal size={20} aria-hidden="true" />
                </button>
                <button type="button" className="btn btn--text selection-done" onClick={onDone}>
                    <X size={18} aria-hidden="true" /><span>Done</span>
                </button>
            </div>
            {moreOpen && (
                <div className="selection-overflow">
                    {secondary}
                    <button type="button" className="btn btn--text" onClick={onDone}>Done</button>
                </div>
            )}
        </div>
    );
};
