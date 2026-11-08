// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { Toast } from '../../src/components/Toast';
import type { ToastState } from '../../src/popup/hooks/useToast';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const base = (over: Partial<ToastState> = {}): ToastState => ({
    id: 1, message: "Deleted 'Recipes'", tone: 'info', actions: [], autoHideMs: 8000, ...over,
});

describe('Toast', () => {
    it('is a polite live region and shows actions', () => {
        const undo = vi.fn();
        render(<Toast toast={base({ actions: [{ label: 'Undo', onClick: undo, primary: true }], onUndo: undo })} onDismiss={() => { }} />);
        const region = screen.getByRole('status');
        expect(region.getAttribute('aria-live')).toBe('polite');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z and Cmd+Z undo, but not while typing in a field', () => {
        const undo = vi.fn();
        render(
            <>
                <input aria-label="search" />
                <Toast toast={base({ onUndo: undo })} onDismiss={() => { }} />
            </>,
        );
        fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'Z', metaKey: true });
        expect(undo).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(screen.getByLabelText('search'), { key: 'z', ctrlKey: true });
        expect(undo).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true }); // redo, not undo
        expect(undo).toHaveBeenCalledTimes(2);
    });

    it('hides after 8 seconds, but not while hovered', () => {
        vi.useFakeTimers();
        const dismiss = vi.fn();
        const { rerender } = render(<Toast toast={base()} onDismiss={dismiss} />);
        fireEvent.mouseEnter(screen.getByText("Deleted 'Recipes'").parentElement!);
        act(() => { vi.advanceTimersByTime(20000); });
        expect(dismiss).not.toHaveBeenCalled();
        fireEvent.mouseLeave(screen.getByText("Deleted 'Recipes'").parentElement!);
        act(() => { vi.advanceTimersByTime(7999); });
        expect(dismiss).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(2); });
        expect(dismiss).toHaveBeenCalledWith(1);
        // A parent re-render with a new onDismiss function must not restart the timer.
        rerender(<Toast toast={base({ id: 2 })} onDismiss={dismiss} />);
        act(() => { vi.advanceTimersByTime(4000); });
        rerender(<Toast toast={base({ id: 2 })} onDismiss={(id) => dismiss(id)} />);
        act(() => { vi.advanceTimersByTime(4001); });
        expect(dismiss).toHaveBeenLastCalledWith(2);
    });

    it('does not hide while the tab is in the background, then gets a full 8 seconds', () => {
        vi.useFakeTimers();
        const dismiss = vi.fn();
        const hidden = vi.spyOn(document, 'hidden', 'get');
        try {
            hidden.mockReturnValue(true);
            render(<Toast toast={base()} onDismiss={dismiss} />);
            act(() => { vi.advanceTimersByTime(60000); });
            expect(dismiss).not.toHaveBeenCalled();
            hidden.mockReturnValue(false);
            act(() => { document.dispatchEvent(new Event('visibilitychange')); });
            act(() => { vi.advanceTimersByTime(7999); });
            expect(dismiss).not.toHaveBeenCalled();
            act(() => { vi.advanceTimersByTime(2); });
            expect(dismiss).toHaveBeenCalledWith(1);
        } finally {
            hidden.mockRestore();
        }
    });

    it('a busy toast has no close button and does not hide', () => {
        vi.useFakeTimers();
        const dismiss = vi.fn();
        render(<Toast toast={base({ busy: true, message: 'Restoring…' })} onDismiss={dismiss} />);
        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
        act(() => { vi.advanceTimersByTime(30000); });
        expect(dismiss).not.toHaveBeenCalled();
    });

    it('a new toast starts unpaused even if the old one was hovered', () => {
        vi.useFakeTimers();
        const dismiss = vi.fn();
        const { rerender } = render(<Toast toast={base()} onDismiss={dismiss} />);
        fireEvent.mouseEnter(screen.getByText("Deleted 'Recipes'").parentElement!);
        rerender(<Toast toast={base({ id: 5, message: 'Trash emptied' })} onDismiss={dismiss} />);
        act(() => { vi.advanceTimersByTime(8001); });
        expect(dismiss).toHaveBeenCalledWith(5);
    });
});
