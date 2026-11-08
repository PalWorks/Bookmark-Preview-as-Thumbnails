// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './Modal';
import { FolderGlyph } from './BookmarkPreview';
import type { FolderColor } from '../lib/folder_prefs';

type Node = chrome.bookmarks.BookmarkTreeNode;


/**
 * Every folder the user can put things into, with its full path. Managed folders
 * are excluded, and so are `exclude` folders with everything inside them (a folder
 * cannot move into itself).
 */
function listFolders(roots: Node[], exclude?: Set<string>): FolderOption[] {
    const out: FolderOption[] = [];
    const walk = (node: Node, path: string[], synced: boolean) => {
        if (node.url || node.unmodifiable || exclude?.has(node.id)) return;
        const here = [...path, node.title || 'Untitled folder'];
        out.push({ id: node.id, path: here, synced });
        for (const c of node.children ?? []) walk(c, here, synced);
    };
    for (const r of roots) walk(r, [], r.syncing === true);
    return out;
}

export interface FolderOption {
    id: string;
    path: string[];
    synced: boolean;
}

interface FolderPickerProps {
    roots: Node[];
    /** What is being restored, for the heading. */
    subject: string;
    busy: boolean;
    onCancel: () => void;
    onPick: (folderId: string) => void;
    /** Dialog title and button text; default "Restore to…" / "Restore here". */
    title?: string;
    actionLabel?: string;
    /** Folders that cannot be chosen, with their subfolders. */
    exclude?: Set<string>;
    /** Folder colours, keyed by id. */
    colors?: Record<string, FolderColor | undefined>;
}

/**
 * "Restore to..." destination picker. Groups folders by storage ("On this device"
 * or "Synced to your account") so a local bookmark is only ever moved into synced
 * storage by an explicit choice. No folder is preselected.
 */
export const FolderPicker: React.FC<FolderPickerProps> = ({
    roots, subject, busy, onCancel, onPick, title = 'Restore to…', actionLabel = 'Restore here', exclude, colors,
}) => {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const all = listFolders(roots, exclude);
    const q = query.trim().toLowerCase();
    const visible = q ? all.filter(f => f.path.join(' ').toLowerCase().includes(q)) : all;
    // A choice hidden by the search box no longer counts as chosen.
    const chosen = selected && visible.some(f => f.id === selected) ? selected : null;
    const local = visible.filter(f => !f.synced);
    const synced = visible.filter(f => f.synced);
    const twoGroups = all.some(f => f.synced) && all.some(f => !f.synced);

    const group = (label: string | null, items: FolderOption[]) => items.length === 0 ? null : (
        <fieldset className="picker-group">
            {label && <legend className="picker-group-label">{label}</legend>}
            {items.map(f => (
                <label key={f.id} className={`picker-option ${chosen === f.id ? 'picker-option--selected' : ''}`}>
                    <input
                        type="radio"
                        name="restore-target"
                        value={f.id}
                        checked={chosen === f.id}
                        onChange={() => setSelected(f.id)}
                    />
                    <FolderGlyph size={16} color={colors?.[f.id]} />
                    <span className="picker-path">{f.path.join(' › ')}</span>
                </label>
            ))}
        </fieldset>
    );

    return (
        <Modal
            title={title}
            onClose={busy ? () => { } : onCancel}
            initialFocusRef={searchRef}
            className="modal--picker"
            footer={(
                <div className="modal-actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className="btn btn--primary btn--grow"
                        disabled={!chosen || busy}
                        onClick={() => chosen && onPick(chosen)}
                    >
                        {busy && <span className="btn-spinner" aria-hidden="true" />}
                        <span>{actionLabel}</span>
                    </button>
                </div>
            )}
        >
            <p className="modal-text">Choose a folder for {subject}.</p>
            <div className="picker-search">
                <Search size={16} aria-hidden="true" />
                <input
                    ref={searchRef}
                    type="search"
                    className="text-field"
                    placeholder="Search folders"
                    aria-label="Search folders"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            <div className="picker-list">
                {twoGroups ? (
                    <>
                        {group('On this device', local)}
                        {group('Synced to your account', synced)}
                    </>
                ) : (
                    group(all.some(f => f.synced) ? 'Synced to your account' : null, visible)
                )}
                {visible.length === 0 && <p className="picker-empty">No folder matches "{query}".</p>}
            </div>
        </Modal>
    );
};
