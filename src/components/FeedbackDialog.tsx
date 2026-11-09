// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Modal } from './Modal';
import {
    FEEDBACK_CATEGORIES,
    MAX_MESSAGE_CHARS,
    submitFeedback,
    validateFeedback,
    type FeedbackCategory,
    type FeedbackDiagnostics,
} from '../lib/feedback';

interface FeedbackDialogProps {
    onClose: () => void;
    /** Counts only; shown to the user before sending and left out if they untick the box. */
    diagnostics: FeedbackDiagnostics;
    /** Overridable for tests. */
    send?: typeof submitFeedback;
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
    bug: 'Something is broken',
    feature: 'Idea or request',
    question: 'Question',
    other: 'Something else',
};

/**
 * In-product feedback form. Posts to our relay (see /worker), which emails the
 * team. What the user typed survives any error, so nothing is ever lost.
 */
export const FeedbackDialog: React.FC<FeedbackDialogProps> = ({ onClose, diagnostics, send = submitFeedback }) => {
    const [category, setCategory] = useState<FeedbackCategory>('feature');
    const [message, setMessage] = useState('');
    const [replyTo, setReplyTo] = useState('');
    const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const messageRef = useRef<HTMLTextAreaElement>(null);
    const doneRef = useRef<HTMLButtonElement>(null);

    const submit = async () => {
        const problem = validateFeedback({ message, replyTo });
        if (problem) { setError(problem); return; }
        setBusy(true);
        setError(null);
        const result = await send({
            category,
            message,
            replyTo,
            ...(includeDiagnostics ? { diagnostics } : {}),
        });
        setBusy(false);
        if (result.ok) {
            setSent(true);
            setTimeout(() => doneRef.current?.focus(), 0);
        } else {
            setError(result.error);
        }
    };

    if (sent) {
        return (
            <Modal
                title="Feedback sent"
                onClose={onClose}
                initialFocusRef={doneRef}
                className="modal--narrow"
                footer={(
                    <div className="modal-actions">
                        <button ref={doneRef} type="button" className="btn btn--primary btn--grow" onClick={onClose}>Done</button>
                    </div>
                )}
            >
                <div className="feedback-sent" role="status">
                    <CheckCircle2 size={28} aria-hidden="true" className="feedback-sent-icon" />
                    <p className="modal-text">
                        Thank you. Your message reached the team.
                        {replyTo.trim() ? ' We will reply to the address you gave.' : ''}
                    </p>
                </div>
            </Modal>
        );
    }

    const remaining = MAX_MESSAGE_CHARS - message.length;

    return (
        <Modal
            title="Send feedback"
            onClose={busy ? () => { } : onClose}
            initialFocusRef={messageRef}
            className="modal--narrow"
            footer={(
                <div className="modal-actions">
                    <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" form="feedback-form" className="btn btn--primary btn--grow" disabled={busy}>
                        {busy && <span className="btn-spinner" aria-hidden="true" />}
                        <span>Send feedback</span>
                    </button>
                </div>
            )}
        >
            <form
                id="feedback-form"
                className="feedback-form"
                noValidate
                onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}
            >
                <fieldset className="feedback-categories">
                    <legend className="field-label">What is it about?</legend>
                    {FEEDBACK_CATEGORIES.map(c => (
                        <label key={c} className={`feedback-chip ${category === c ? 'feedback-chip--on' : ''}`}>
                            <input
                                type="radio"
                                name="feedback-category"
                                value={c}
                                checked={category === c}
                                onChange={() => setCategory(c)}
                                disabled={busy}
                            />
                            <span>{CATEGORY_LABELS[c]}</span>
                        </label>
                    ))}
                </fieldset>

                <div>
                    <label className="field-label" htmlFor="feedback-message">Your message</label>
                    <textarea
                        id="feedback-message"
                        ref={messageRef}
                        className="text-field feedback-message"
                        rows={6}
                        maxLength={MAX_MESSAGE_CHARS}
                        value={message}
                        onChange={(e) => { setMessage(e.target.value); if (error) setError(null); }}
                        placeholder="What happened, or what would make this better?"
                        aria-describedby="feedback-count"
                        disabled={busy}
                    />
                    <div id="feedback-count" className="feedback-count" aria-live="polite">
                        {remaining < 500 ? `${remaining} characters left` : ''}
                    </div>
                </div>

                <div>
                    <label className="field-label" htmlFor="feedback-email">Email for a reply (optional)</label>
                    <input
                        id="feedback-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        className="text-field"
                        value={replyTo}
                        onChange={(e) => { setReplyTo(e.target.value); if (error) setError(null); }}
                        placeholder="you@example.com"
                        disabled={busy}
                    />
                </div>

                <label className="feedback-diagnostics">
                    <input
                        type="checkbox"
                        checked={includeDiagnostics}
                        onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                        disabled={busy}
                    />
                    <span>
                        Include technical details: version {diagnostics.version}, {diagnostics.browser},
                        {' '}{diagnostics.bookmarks} bookmarks, {diagnostics.folders} folders, {diagnostics.view} view.
                        No titles, links or folder names.
                    </span>
                </label>

                {error && (
                    <div className="inline-banner inline-banner--error" role="alert">{error}</div>
                )}
            </form>
        </Modal>
    );
};
