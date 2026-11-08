// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from 'react';
import { Modal } from './Modal';
import { plural } from '../lib/utils';

interface EmptyTrashDialogProps {
    count: number;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

const CONFIRM_WORD = 'EMPTY';

/** Emptying Trash is the one irreversible action, so it needs a typed confirmation. */
export const EmptyTrashDialog: React.FC<EmptyTrashDialogProps> = ({ count, busy, onCancel, onConfirm }) => {
    const [typed, setTyped] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (ready && !busy) onConfirm();
    };

    return (
        <Modal title="Empty Trash?" onClose={busy ? () => { } : onCancel} initialFocusRef={inputRef} className="modal--narrow">
            <form onSubmit={submit} className="empty-trash-form">
                <p className="modal-text">
                    Permanently delete {plural(count, 'bookmark')}? This can't be undone.
                    Previews still used by other bookmarks are kept. Copies saved to a connected
                    storage folder on your disk are not removed.
                </p>
                <label className="field-label" htmlFor="empty-trash-confirm">
                    Type <strong>{CONFIRM_WORD}</strong> to confirm
                </label>
                <input
                    id="empty-trash-confirm"
                    ref={inputRef}
                    className="text-field"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={busy}
                />
                <div className="modal-actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button type="submit" className="btn btn--danger" disabled={!ready || busy}>
                        {busy && <span className="btn-spinner" aria-hidden="true" />}
                        <span>Empty Trash</span>
                    </button>
                </div>
            </form>
        </Modal>
    );
};
