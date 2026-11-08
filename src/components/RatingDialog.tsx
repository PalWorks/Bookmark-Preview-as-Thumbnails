// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { Modal } from './Modal';

interface RatingDialogProps {
    title: string;
    current?: number;
    busy: boolean;
    onCancel: () => void;
    /** 1 to 5, or null for "No rating". */
    onSave: (rating: number | null) => void;
}

/** Rate a link 1 to 5 stars. A radio group: arrow keys move, Space or Enter picks. */
export const RatingDialog: React.FC<RatingDialogProps> = ({ title, current, busy, onCancel, onSave }) => {
    const [value, setValue] = useState<number>(current ?? 0);
    const firstRef = useRef<HTMLInputElement>(null);
    return (
        <Modal
            title="Rate this link"
            onClose={busy ? () => { } : onCancel}
            initialFocusRef={firstRef}
            className="modal--narrow"
            footer={(
                <div className="modal-actions">
                    <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button type="button" className="btn btn--primary btn--grow" disabled={busy}
                        onClick={() => onSave(value === 0 ? null : value)}>
                        {busy && <span className="btn-spinner" aria-hidden="true" />}
                        <span>Save rating</span>
                    </button>
                </div>
            )}
        >
            <p className="modal-text">{title}</p>
            <fieldset className="rating-group">
                <legend className="visually-hidden">Rating</legend>
                {[1, 2, 3, 4, 5].map(n => (
                    <label key={n} className={`rating-option ${value >= n ? 'rating-option--on' : ''}`}>
                        <input
                            ref={n === (value || 1) ? firstRef : undefined}
                            type="radio"
                            name="rating"
                            value={n}
                            checked={value === n}
                            onChange={() => setValue(n)}
                        />
                        <Star size={22} aria-hidden="true" className="rating-star" />
                        <span className="rating-number">{n}</span>
                    </label>
                ))}
            </fieldset>
            <label className={`rating-clear ${value === 0 ? 'rating-clear--on' : ''}`}>
                <input type="radio" name="rating" value={0} checked={value === 0} onChange={() => setValue(0)} />
                <span>No rating</span>
            </label>
            <p className="sub-text">Applies to every bookmark of this link.</p>
        </Modal>
    );
};
