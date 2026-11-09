// SPDX-License-Identifier: AGPL-3.0-only
//
// A list of folders with tick boxes, nothing ticked by default. Folders hidden
// from search are never listed. Used to choose what an AI or a coding agent sees.

import React, { useMemo } from 'react';
import { folderRows } from '../lib/folder_rows';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface Props {
    roots: Node[];
    hiddenFolderIds: Set<string>;
    chosen: Set<string>;
    onChange: (next: Set<string>) => void;
    legend: string;
    disabled?: boolean;
}

export const FolderChecklist: React.FC<Props> = ({ roots, hiddenFolderIds, chosen, onChange, legend, disabled }) => {
    const rows = useMemo(() => folderRows(roots, hiddenFolderIds), [roots, hiddenFolderIds]);
    const toggle = (id: string) => {
        const next = new Set(chosen);
        if (next.has(id)) next.delete(id); else next.add(id);
        onChange(next);
    };
    return (
        <fieldset className="ai-folder-list" disabled={disabled}>
            <legend className="field-label">{legend}</legend>
            {rows.length === 0 && <p className="picker-empty">No folders to share.</p>}
            {rows.map(r => (
                <label key={r.id} className="ai-folder-row" style={{ paddingInlineStart: 8 + r.depth * 16 }}>
                    <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} />
                    <span className="ai-folder-title">{r.title}</span>
                    <span className="ai-folder-count">{r.count}</span>
                </label>
            ))}
        </fieldset>
    );
};
