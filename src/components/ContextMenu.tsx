import React, { useEffect, useRef } from 'react';

export interface MenuItem {
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

export const ContextMenu: React.FC<ContextMenuProps> = ({ position, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleScroll = () => {
            onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', onClose);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    const [adjustedPosition, setAdjustedPosition] = React.useState(position);

    React.useLayoutEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            let newX = position.x;
            let newY = position.y;

            // Safety margin
            const padding = 10;

            // Check horizontal overflow
            // If the menu goes off the right edge
            if (newX + rect.width + padding > window.innerWidth) {
                // Shift it to the left of the cursor/click point
                // If we shift it left, we want it to end at position.x
                newX = position.x - rect.width;
            }

            // If shifting left makes it go off the left edge, clamp it
            if (newX < padding) {
                newX = padding;
            }

            // Check vertical overflow
            // If the menu goes off the bottom edge
            if (newY + rect.height + padding > window.innerHeight) {
                // Shift it up
                newY = position.y - rect.height;
            }

            // If shifting up makes it go off the top edge, clamp it
            if (newY < padding) {
                newY = padding;
            }

            setAdjustedPosition({ x: newX, y: newY });
        }
    }, [position]);

    const style: React.CSSProperties = {
        top: adjustedPosition.y,
        left: adjustedPosition.x,
        visibility: 'visible', // Ensure it's visible after positioning
    };

    return (
        <div className="context-menu" ref={menuRef} style={style}>
            {items.map((item, index) => (
                item.separator ? (
                    <div key={index} className="menu-separator" />
                ) : (
                    <div
                        key={index}
                        className={`menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''}`}
                        onClick={() => {
                            if (!item.disabled) {
                                item.action();
                                onClose();
                            }
                        }}
                    >
                        {item.label}
                    </div>
                )
            ))}
        </div>
    );
};
