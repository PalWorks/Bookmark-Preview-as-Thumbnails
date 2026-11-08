// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';

export interface ToastAction {
    label: string;
    onClick: () => void;
    /** Visually primary (Undo). */
    primary?: boolean;
}

export interface ToastState {
    id: number;
    message: string;
    tone: 'info' | 'success' | 'error';
    actions: ToastAction[];
    /** Shows a spinner and disables the actions (Deleting..., Restoring...). */
    busy?: boolean;
    /** Ctrl/Cmd+Z runs this while the toast is visible. */
    onUndo?: () => void;
    /** Milliseconds before it hides itself; 0 keeps it until dismissed. */
    autoHideMs: number;
}

export type ToastInput = Omit<ToastState, 'id' | 'actions' | 'autoHideMs' | 'tone'>
    & Partial<Pick<ToastState, 'actions' | 'autoHideMs' | 'tone'>>;

/** One toast at a time: the newest replaces the previous (older deletes stay in Trash). */
export function useToast() {
    const [toast, setToast] = useState<ToastState | null>(null);
    const seq = useRef(0);

    const show = (input: ToastInput): number => {
        const id = ++seq.current;
        setToast({ tone: 'info', actions: [], autoHideMs: 8000, ...input, id });
        return id;
    };

    /** Change a toast that is still showing; ignored if a newer one replaced it. */
    const update = (id: number, input: Partial<ToastInput>): void => {
        setToast(prev => (prev && prev.id === id ? { ...prev, ...input } : prev));
    };

    /** Replace the toast with `id`, or show a new one if it was already dismissed. */
    const replace = (id: number, input: ToastInput): void => {
        setToast(prev => (prev && prev.id !== id ? prev : { tone: 'info', actions: [], autoHideMs: 8000, ...input, id }));
    };

    const dismiss = (id?: number): void => {
        setToast(prev => (prev && (id === undefined || prev.id === id) ? null : prev));
    };

    return { toast, show, update, replace, dismiss };
}

export type ToastApi = ReturnType<typeof useToast>;
