// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import type { ToastState } from '../popup/hooks/useToast';

interface ToastProps {
    toast: ToastState | null;
    onDismiss: (id: number) => void;
}

function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function subscribeVisibility(onChange: () => void): () => void {
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
}
const isPageHidden = () => document.hidden;

/**
 * Bottom toast. Announced politely and never takes focus, but is reachable with
 * Tab. Hides after its timeout unless hovered, focused or the tab is in the
 * background (the timer restarts when the user comes back). Ctrl/Cmd+Z undoes the
 * operation it shows, except while typing in a field (native undo wins there).
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {/* Keyed by id: hover/focus pause state belongs to one toast only. */}
        {toast && <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />}
    </div>
);

const ToastCard: React.FC<{ toast: ToastState; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const pageHidden = useSyncExternalStore(subscribeVisibility, isPageHidden, () => false);
    const paused = hovered || focused || pageHidden;
    // The parent passes a new function each render; a ref keeps the timer stable.
    const dismissRef = useRef(onDismiss);
    useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

    const { id, busy, autoHideMs, onUndo } = toast;

    useEffect(() => {
        if (busy || autoHideMs <= 0 || paused) return;
        const timer = setTimeout(() => dismissRef.current(id), autoHideMs);
        return () => clearTimeout(timer);
    }, [id, busy, autoHideMs, paused, toast.message]);

    useEffect(() => {
        if (!onUndo || busy) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
            if (isEditable(e.target)) return;
            e.preventDefault();
            onUndo();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onUndo, busy]);

    return (
        <div
            className={`toast toast--${toast.tone}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
        >
            {busy && <span className="toast-spinner" aria-hidden="true" />}
            <span className="toast-message">{toast.message}</span>
            {toast.actions.length > 0 && (
                <span className="toast-actions">
                    {toast.actions.map(a => (
                        <button
                            key={a.label}
                            type="button"
                            className={`toast-btn ${a.primary ? 'toast-btn--primary' : ''}`}
                            onClick={a.onClick}
                            disabled={busy}
                            title={a.primary && onUndo ? `${a.label} (Ctrl+Z)` : undefined}
                        >
                            {a.label}
                        </button>
                    ))}
                </span>
            )}
            {!busy && (
                <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(id)}>
                    <X size={18} aria-hidden="true" />
                </button>
            )}
        </div>
    );
};
