// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './Modal';
import { FolderGlyph } from './BookmarkPreview';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface FolderOption {
    id: string;
    path: string[];
    synced: boolean;
}

/** Every folder the user can restore into, with its full path. Managed folders are excluded. */
function listFolders(roots: Node[]): FolderOption[] {
    const out: FolderOption[] = [];
    const walk = (node: Node, path: string[], synced: boolean) => {
        if (node.url || node.unmodifiable) return;
        const here = [...path, node.title || 'Untitled folder'];
        out.push({ id: node.id, path: here, synced });
        for (const c of node.children ?? []) walk(c, here, synced);
    };
    for (const r of roots) walk(r, [], r.syncing === true);
    return out;
}

interface FolderPickerProps {
    roots: Node[];
    /** What is being restored, for the heading. */
    subject: string;
    busy: boolean;
    onCancel: () => void;
    onPick: (folderId: string) => void;
}

/**
 * "Restore to..." destination picker. Groups folders by storage ("On this device"
 * or "Synced to your account") so a local bookmark is only ever moved into synced
 * storage by an explicit choice. No folder is preselected.
 */
export const FolderPicker: React.FC<FolderPickerProps> = ({ roots, subject, busy, onCancel, onPick }) => {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const all = listFolders(roots);
    const q = query.trim().toLowerCase();
    const visible = q ? all.filter(f => f.path.join(' ').toLowerCase().includes(q)) : all;
    const local = visible.filter(f => !f.synced);
    const synced = visible.filter(f => f.synced);
    const twoGroups = all.some(f => f.synced) && all.some(f => !f.synced);

    const group = (label: string | null, items: FolderOption[]) => items.length === 0 ? null : (
        <fieldset className="picker-group">
            {label && <legend className="picker-group-label">{label}</legend>}
            {items.map(f => (
                <label key={f.id} className={`picker-option ${selected === f.id ? 'picker-option--selected' : ''}`}>
                    <input
                        type="radio"
                        name="restore-target"
                        value={f.id}
                        checked={selected === f.id}
                        onChange={() => setSelected(f.id)}
                    />
                    <FolderGlyph size={16} />
                    <span className="picker-path">{f.path.join(' › ')}</span>
                </label>
            ))}
        </fieldset>
    );

    return (
        <Modal
            title="Restore to…"
            onClose={busy ? () => { } : onCancel}
            initialFocusRef={searchRef}
            className="modal--picker"
            footer={(
                <div className="modal-actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className="btn btn--primary btn--grow"
                        disabled={!selected || busy}
                        onClick={() => selected && onPick(selected)}
                    >
                        {busy && <span className="btn-spinner" aria-hidden="true" />}
                        <span>Restore here</span>
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
