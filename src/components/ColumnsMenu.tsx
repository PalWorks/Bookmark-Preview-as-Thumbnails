// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef, useState } from 'react';
import { Columns3 } from 'lucide-react';
import { LIST_COLUMNS, LIST_COLUMN_LABELS, HISTORY_COLUMNS, type ListColumn } from '../lib/list_columns';
import type { HistoryPermission } from '../popup/hooks/useHistoryStats';

interface ColumnsMenuProps {
    columns: ListColumn[];
    onChange: (columns: ListColumn[]) => void;
    permission: HistoryPermission;
    /** Ask Chrome for history access; must run straight from the click. */
    onRequestHistory: () => Promise<boolean>;
    /** Give history access back when no history column is on. */
    onReleaseHistory: () => void;
    historyError: boolean;
}

/** List view column chooser. History columns need Chrome's permission first. */
export const ColumnsMenu: React.FC<ColumnsMenuProps> = ({
    columns, onChange, permission, onRequestHistory, onReleaseHistory, historyError,
}) => {
    const [open, setOpen] = useState(false);
    const [declined, setDeclined] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const toggle = (col: ListColumn, on: boolean) => {
        const next = on ? LIST_COLUMNS.filter(c => c === col || columns.includes(c)) : columns.filter(c => c !== col);
        const needsHistory = HISTORY_COLUMNS.includes(col);
        if (on && needsHistory && permission !== 'granted') {
            // First call in the click handler: Chrome only shows its prompt for a user gesture.
            void onRequestHistory().then(granted => {
                setDeclined(!granted);
                if (granted) onChange(next);
            });
            return;
        }
        onChange(next);
        if (!on && needsHistory && !next.some(c => HISTORY_COLUMNS.includes(c)) && permission === 'granted') onReleaseHistory();
    };

    return (
        <div className="columns-menu" ref={wrapRef}>
            <button ref={buttonRef} type="button" className="btn btn--text columns-btn" aria-expanded={open}
                aria-controls="columns-panel" onClick={() => setOpen(o => !o)}>
                <Columns3 size={18} aria-hidden="true" /><span>Columns</span>
            </button>
            {open && (
                <div id="columns-panel" className="columns-panel" role="group" aria-label="Columns">
                    {LIST_COLUMNS.map(col => {
                        const history = HISTORY_COLUMNS.includes(col);
                        const checked = columns.includes(col) && (!history || permission === 'granted');
                        return (
                            <label key={col} className="columns-option">
                                <input type="checkbox" checked={checked} onChange={e => toggle(col, e.target.checked)} />
                                <span>{LIST_COLUMN_LABELS[col]}</span>
                            </label>
                        );
                    })}
                    <p className="columns-note">
                        {columnsNote(permission, declined, historyError)}
                    </p>
                </div>
            )}
        </div>
    );
};

function columnsNote(permission: HistoryPermission, declined: boolean, error: boolean): string {
    if (permission === 'granted') {
        return error
            ? "Couldn't read some of Chrome's history."
            : "Visits and Last visited come from Chrome's history on this device, per exact link.";
    }
    if (declined) return "Chrome didn't allow history access. Tick Visits or Last visited to ask again.";
    return "Opened counts opens from this page and Chrome's bookmark manager. Visits and Last visited need access to Chrome's history; it stays on this device.";
}
