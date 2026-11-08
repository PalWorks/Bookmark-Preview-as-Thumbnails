// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef } from 'react';
import { Sparkles, Trash2, X } from 'lucide-react';
import { FolderGlyph } from './BookmarkPreview';
import { buildDeepCountMap, plural } from '../lib/utils';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface SidebarProps {
    folders: Node[];
    selectedFolderId: string;
    onSelectFolder: (id: string) => void;
    onContextMenu: (e: React.MouseEvent, node: Node) => void;
    onAISettings: () => void;
    isAISettingsActive: boolean;
    onTrash: () => void;
    isTrashActive: boolean;
    /** Bookmarks currently in Trash. */
    trashCount: number;
    /** 'drawer' on narrow screens: overlay with a scrim, closes on Escape. */
    variant?: 'docked' | 'drawer';
    onClose?: () => void;
}

export const SIDEBAR_ID = 'folders-panel';

export const Sidebar: React.FC<SidebarProps> = ({
    folders, selectedFolderId, onSelectFolder, onContextMenu,
    onAISettings, isAISettingsActive, onTrash, isTrashActive, trashCount,
    variant = 'docked', onClose,
}) => {
    const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set(['1'])); // Default expand Bookmarks Bar
    const panelRef = useRef<HTMLElement>(null);
    const isDrawer = variant === 'drawer';

    // Drawer: focus the selected folder on open, close on Escape, return focus on close.
    useEffect(() => {
        if (!isDrawer) return;
        const opener = document.activeElement as HTMLElement | null;
        const panel = panelRef.current;
        const target = panel?.querySelector<HTMLElement>('.sidebar-item.selected .sidebar-item-main')
            ?? panel?.querySelector<HTMLElement>('button');
        target?.focus();
        const onKey = (e: KeyboardEvent) => {
            // An open context menu handles its own Escape first.
            if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose?.(); return; }
            // Keep Tab inside the drawer while it covers the page.
            if (e.key !== 'Tab' || !panel) return;
            const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled])')];
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
        // Runs once per drawer opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDrawer]);

    const toggleExpand = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
            return next;
        });
    };

    // Deep counts (bookmarks in a folder and all its subfolders), derived per render.
    const counts = buildDeepCountMap(folders);

    const renderTree = (nodes: Node[], depth = 0): React.ReactNode => nodes.map((node) => {
        // Only show folders in sidebar
        if (node.url) return null;

        const isSelected = node.id === selectedFolderId;
        const hasChildren = !!node.children?.some(child => !child.url); // Only care if it has sub-folders
        const isExpanded = expandedFolders.has(node.id);
        const count = counts.get(node.id) ?? 0;
        const name = node.title || 'Untitled folder';
        const countLabel = `${plural(count, 'bookmark')}, including subfolders`;

        return (
            <li key={node.id} role="none">
                <div
                    className={`sidebar-item ${isSelected ? 'selected' : ''}`}
                    style={{ '--depth': depth } as React.CSSProperties}
                    onContextMenu={(e) => onContextMenu(e, node)}
                >
                    {hasChildren ? (
                        <button
                            type="button"
                            className="arrow-container visible"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${name}`}
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpand(node.id)}
                        >
                            <svg viewBox="0 0 20 20" className={`tree-arrow ${isExpanded ? 'expanded' : ''}`} aria-hidden="true">
                                <path d="M6 6L14 10L6 14V6Z" fill="currentColor" />
                            </svg>
                        </button>
                    ) : (
                        <span className="arrow-container" aria-hidden="true" />
                    )}
                    <button
                        type="button"
                        className="sidebar-item-main"
                        title={`${name}, ${countLabel}`}
                        aria-current={isSelected ? 'page' : undefined}
                        onClick={() => {
                            onSelectFolder(node.id);
                            if (hasChildren && !isExpanded) toggleExpand(node.id);
                        }}
                    >
                        <span className="folder-icon-wrapper"><FolderGlyph size={16} /></span>
                        <span className="folder-name">{name}</span>
                        {count > 0 && <span className="folder-count" aria-label={countLabel}>{count}</span>}
                    </button>
                </div>
                {hasChildren && isExpanded && node.children && (
                    <ul className="sidebar-tree" role="none">{renderTree(node.children, depth + 1)}</ul>
                )}
            </li>
        );
    });

    const panel = (
        <nav
            id={SIDEBAR_ID}
            ref={panelRef}
            className={`sidebar ${isDrawer ? 'sidebar--drawer' : ''}`}
            aria-label="Folders"
        >
            <div className="sidebar-header">
                <div>Folders</div>
                {isDrawer && (
                    <button type="button" className="sidebar-close" aria-label="Close folders" onClick={onClose}>
                        <X size={20} aria-hidden="true" />
                    </button>
                )}
            </div>
            <div className="sidebar-content">
                <ul className="sidebar-tree" role="none">{renderTree(folders)}</ul>
            </div>
            <div className="sidebar-footer">
                <button
                    type="button"
                    className={`sidebar-ai-btn ${isTrashActive ? 'sidebar-ai-btn--active' : ''}`}
                    onClick={onTrash}
                    aria-current={isTrashActive ? 'page' : undefined}
                >
                    <Trash2 size={15} className="sidebar-trash-icon" aria-hidden="true" />
                    <span>Trash</span>
                    {trashCount > 0 && (
                        <span className="folder-count" aria-label={`${plural(trashCount, 'item')} in Trash`}>{trashCount}</span>
                    )}
                </button>
                <button
                    type="button"
                    className={`sidebar-ai-btn ${isAISettingsActive ? 'sidebar-ai-btn--active' : ''}`}
                    onClick={onAISettings}
                    aria-current={isAISettingsActive ? 'page' : undefined}
                >
                    <Sparkles size={15} className="sidebar-ai-icon" aria-hidden="true" />
                    <span>AI Settings</span>
                </button>
            </div>
        </nav>
    );

    if (!isDrawer) return panel;
    return (
        <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Folders">
            <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
            {panel}
        </div>
    );
};
