// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from './Modal';
import { FolderGlyph } from './BookmarkPreview';
import { FOLDER_COLORS, FOLDER_COLOR_LABELS, type FolderColor } from '../lib/folder_prefs';

interface FolderColorDialogProps {
    folderTitle: string;
    current?: FolderColor;
    busy: boolean;
    onCancel: () => void;
    /** null is the default yellow. */
    onSave: (color: FolderColor | null) => void;
}

const CHOICES: Array<FolderColor | 'default'> = ['default', ...FOLDER_COLORS];

/** Pick a folder colour: named swatches (not colour alone), saved on this device. */
export const FolderColorDialog: React.FC<FolderColorDialogProps> = ({ folderTitle, current, busy, onCancel, onSave }) => {
    const [value, setValue] = useState<FolderColor | 'default'>(current ?? 'default');
    const selectedRef = useRef<HTMLInputElement>(null);
    return (
        <Modal
            title="Folder colour"
            onClose={busy ? () => { } : onCancel}
            initialFocusRef={selectedRef}
            className="modal--narrow"
            footer={(
                <div className="modal-actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button type="button" className="btn btn--primary btn--grow" disabled={busy}
                        onClick={() => onSave(value === 'default' ? null : value)}>
                        {busy && <span className="btn-spinner" aria-hidden="true" />}
                        <span>Save colour</span>
                    </button>
                </div>
            )}
        >
            <p className="modal-text">Colour for '{folderTitle}'. Saved on this device.</p>
            <fieldset className="swatch-grid">
                <legend className="visually-hidden">Colour</legend>
                {CHOICES.map(c => (
                    <label key={c} className={`swatch ${value === c ? 'swatch--on' : ''}`}>
                        <input
                            ref={value === c ? selectedRef : undefined}
                            type="radio"
                            name="folder-colour"
                            value={c}
                            checked={value === c}
                            onChange={() => setValue(c)}
                        />
                        <span className="swatch-icon">
                            <FolderGlyph size={28} color={c === 'default' ? undefined : c} />
                            {value === c && <Check size={14} className="swatch-check" aria-hidden="true" />}
                        </span>
                        <span className="swatch-name">{c === 'default' ? 'Yellow' : FOLDER_COLOR_LABELS[c]}</span>
                    </label>
                ))}
            </fieldset>
        </Modal>
    );
};
