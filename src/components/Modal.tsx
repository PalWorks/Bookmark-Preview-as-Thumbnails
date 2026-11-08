// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    /** Element to focus when the dialog opens (default: the first focusable one). */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    className?: string;
    /** Optional footer, kept visible below scrolling content. */
    footer?: React.ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: traps focus, closes on Escape or a scrim click, and returns
 * focus to whatever opened it.
 */
export const Modal: React.FC<ModalProps> = ({ title, onClose, children, initialFocusRef, className = '', footer }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        const dialog = dialogRef.current;
        const first = initialFocusRef?.current ?? dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
        first?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closeRef.current();
                return;
            }
            if (e.key !== 'Tab' || !dialog) return;
            const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
            if (items.length === 0) { e.preventDefault(); return; }
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
            else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
        // initialFocusRef is read once on open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            className="modal-scrim"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={dialogRef}
                className={`modal ${className}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <div className="modal-header">
                    <h2 id={titleId} className="modal-title">{title}</h2>
                    <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
};
