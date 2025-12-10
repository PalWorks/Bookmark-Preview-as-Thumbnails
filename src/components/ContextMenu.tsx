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

    // Adjust position to keep menu within viewport
    const style: React.CSSProperties = {
        top: position.y,
        left: position.x,
    };

    if (menuRef.current) {
        const rect = menuRef.current.getBoundingClientRect();
        if (position.x + rect.width > window.innerWidth) {
            style.left = position.x - rect.width;
        }
        if (position.y + rect.height > window.innerHeight) {
            style.top = position.y - rect.height;
        }
    }

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
