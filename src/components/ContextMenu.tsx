// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface MenuItem {
    label: string;
    action: () => void;
    disabled?: boolean;
    separator?: boolean;
    danger?: boolean;
}

interface ContextMenuProps {
    position: { x: number; y: number };
    items: MenuItem[];
    onClose: () => void;
}

/**
 * Bookmark/folder actions menu. Real buttons with roving focus: arrow keys move,
 * Home/End jump, Escape or Tab closes, and focus returns to the opener (handled
 * by useContextMenu).
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ position, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeRef.current();
        };
        const close = () => closeRef.current();
        document.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, []);

    const [adjustedPosition, setAdjustedPosition] = useState(position);

    useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const padding = 8;
        let x = position.x;
        let y = position.y;
        if (x + rect.width + padding > window.innerWidth) x = position.x - rect.width;
        if (x < padding) x = padding;
        if (y + rect.height + padding > window.innerHeight) y = position.y - rect.height;
        if (y < padding) y = padding;
        // Measured layout must be applied before paint, so this is a layout effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAdjustedPosition({ x, y });
        // Focus the first enabled item so the keyboard works immediately.
        el.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
        // Numbers, not the object: the parent passes a new object every render.
    }, [position.x, position.y]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const focusAt = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); focusAt(i + 1); break;
            case 'ArrowUp': e.preventDefault(); focusAt(i - 1); break;
            case 'Home': e.preventDefault(); focusAt(0); break;
            case 'End': e.preventDefault(); focusAt(buttons.length - 1); break;
            case 'Escape': case 'Tab':
                // preventDefault also tells the folders drawer not to close on this Escape.
                e.preventDefault();
                onClose();
                break;
        }
    };

    return (
        <div
            className="context-menu"
            ref={menuRef}
            role="menu"
            style={{ top: adjustedPosition.y, left: adjustedPosition.x }}
            onKeyDown={onKeyDown}
        >
            {items.map((item, index) => (
                item.separator ? (
                    <div key={index} className="menu-separator" role="separator" />
                ) : (
                    <button
                        key={index}
                        type="button"
                        role="menuitem"
                        className={`ctx-menu-item ${item.danger ? 'danger' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            if (item.disabled) return;
                            item.action();
                            onClose();
                        }}
                    >
                        {item.label}
                    </button>
                )
            ))}
        </div>
    );
};
