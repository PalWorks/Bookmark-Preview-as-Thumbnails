// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { FolderPrefs } from '../../lib/folder_prefs';
import { renameNode, type RenameResult } from '../../lib/rename';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface ContextMenuDeps {
    selectedFolderId: string;
    currentFolderId: string | undefined;
    refreshTree: () => void;
    refreshCurrentFolder: (folderId: string) => void;
    onTriggerCapture: (urls: string[]) => void;
    clipboard: { mode: 'cut' | 'copy'; node: Node } | null;
    onCut: (targetId: string) => void;
    onCopy: (targetId: string) => void;
    onPaste: (targetParentId: string) => Promise<void>;
    /** Delete through Trash (with Undo); no confirmation dialog. */
    onDelete: (node: { id: string; title: string }) => void;
    /** False in incognito, where Trash is read-only. */
    canDelete: boolean;
    /** Folder colours and hidden-from-search (1.4.0). */
    folderPrefs?: FolderPrefs;
    onEditColor?: (folder: { id: string; title: string }) => void;
    onSetHidden?: (folder: { id: string; title: string }, hidden: boolean) => void;
    /** Links opened from the menu (recorded as "Opened"). */
    onOpened?: (urls: string[]) => void;
    /** A rename finished or was refused: the page shows the result with Undo. */
    onRenamed?: (result: RenameResult) => void;
}

export function useContextMenu({
    selectedFolderId,
    currentFolderId,
    refreshTree,
    refreshCurrentFolder,
    onTriggerCapture,
    clipboard,
    onCut,
    onCopy,
    onPaste,
    onDelete,
    canDelete,
    folderPrefs = {},
    onEditColor,
    onSetHidden,
    onOpened,
    onRenamed,
}: ContextMenuDeps) {
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean;
        x: number;
        y: number;
        targetId: string;
        title: string;
        type: 'folder' | 'bookmark';
        itemCount?: number;
        permanent?: boolean;
    }>({ visible: false, x: 0, y: 0, targetId: '', title: '', type: 'bookmark' });
    // Element that opened the menu; focus returns there when it closes.
    const openerRef = useRef<HTMLElement | null>(null);

    const handleContextMenu = (e: React.MouseEvent, node: Node) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLElement | null;
        // Return focus to the focused control inside the row (keyboard: Shift+F10 or
        // the menu key), else to the element the event was attached to.
        const active = document.activeElement as HTMLElement | null;
        const opener = active && target?.contains(active) ? active : target;
        openerRef.current = opener;
        // A keyboard "click" has no pointer position: open below the button instead.
        let x = e.clientX;
        let y = e.clientY;
        if ((x === 0 && y === 0) && opener?.getBoundingClientRect) {
            const r = opener.getBoundingClientRect();
            x = r.left;
            y = r.bottom;
        }
        const permanent = !node.parentId || node.parentId === '0';
        if (!node.url) {
            chrome.bookmarks.getChildren(node.id, (children) => {
                setContextMenu({
                    visible: true, x, y,
                    targetId: node.id, title: node.title, type: 'folder',
                    itemCount: (children ?? []).filter(c => c.url).length,
                    permanent,
                });
            });
        } else {
            setContextMenu({
                visible: true, x, y,
                targetId: node.id, title: node.title, type: 'bookmark',
            });
        }
    };

    const closeContextMenu = () => {
        setContextMenu(prev => ({ ...prev, visible: false }));
        const opener = openerRef.current;
        openerRef.current = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    };

    const handleRename = () => {
        const { targetId } = contextMenu;
        chrome.bookmarks.get(targetId, (results) => {
            if (!results?.length) return;
            const newTitle = prompt('Rename to:', results[0].title);
            if (newTitle === null) return;
            void renameNode(targetId, newTitle).then(result => {
                if (!result) return; // unchanged
                refreshTree();
                if (currentFolderId) refreshCurrentFolder(currentFolderId);
                onRenamed?.(result);
            });
        });
    };

    const handleDelete = () => {
        const { targetId, title } = contextMenu;
        onDelete({ id: targetId, title });
    };

    const handleOpen = (mode: 'tab' | 'window' | 'incognito') => {
        const { targetId } = contextMenu;
        chrome.bookmarks.get(targetId, (results) => {
            if (!results?.length) return;
            const node = results[0];
            if (node.url) {
                onOpened?.([node.url]);
                if (mode === 'tab') chrome.tabs.create({ url: node.url });
                else if (mode === 'window') chrome.windows.create({ url: node.url });
                else chrome.windows.create({ url: node.url, incognito: true });
            } else {
                chrome.bookmarks.getChildren(targetId, (children) => {
                    const urls = children.filter(c => c.url).map(c => c.url!);
                    if (!urls.length) return;
                    onOpened?.(urls);
                    if (mode === 'tab') urls.forEach(url => chrome.tabs.create({ url }));
                    else if (mode === 'window') chrome.windows.create({ url: urls });
                    else chrome.windows.create({ url: urls, incognito: true });
                });
            }
        });
    };

    const handleRegenerate = () => {
        const { targetId } = contextMenu;
        chrome.bookmarks.get(targetId, (results) => {
            if (!results?.length) return;
            const node = results[0];
            // The menu item is disabled for folders, so only bookmarks reach here.
            if (node.url) onTriggerCapture([node.url]);
        });
        closeContextMenu();
    };

    const getOpenLabel = (suffix: string) => {
        if (contextMenu.type === 'folder' && contextMenu.itemCount) {
            return `Open all (${contextMenu.itemCount}) ${suffix}`;
        }
        return `Open ${suffix}`;
    };

    // Rebuilt each render (cheap, and the menu only renders while visible). A
    // useMemo here was ineffective anyway — its handler closures are recreated
    // every render, so they could never match the manual dependency list.
    const isFolder = contextMenu.type === 'folder';
    const hidden = !!folderPrefs[contextMenu.targetId]?.hideFromSearch;
    const folderItems = isFolder && !contextMenu.permanent && onEditColor && onSetHidden ? [
        { separator: true, label: '', action: () => { } },
        { label: 'Colour…', action: () => onEditColor({ id: contextMenu.targetId, title: contextMenu.title }) },
        {
            label: hidden ? 'Show in search' : 'Hide from search',
            action: () => onSetHidden({ id: contextMenu.targetId, title: contextMenu.title }, !hidden),
        },
    ] : [];
    const menuItems = [
        { label: 'Rename', action: handleRename, disabled: contextMenu.permanent },
        { label: 'Delete', action: handleDelete, danger: true, disabled: !canDelete || contextMenu.permanent },
        { separator: true, label: '', action: () => { } },
        { label: 'Regenerate Preview', action: handleRegenerate, disabled: contextMenu.type === 'folder' },
        ...folderItems,
        { separator: true, label: '', action: () => { } },
        { label: 'Cut', action: () => onCut(contextMenu.targetId) },
        { label: 'Copy', action: () => onCopy(contextMenu.targetId) },
        {
            label: 'Paste',
            action: () => {
                const targetParentId = contextMenu.type === 'folder' ? contextMenu.targetId : selectedFolderId;
                onPaste(targetParentId);
            },
            disabled: !clipboard,
        },
        { separator: true, label: '', action: () => { } },
        { label: getOpenLabel('in new tab'), action: () => handleOpen('tab') },
        { label: getOpenLabel('in new window'), action: () => handleOpen('window') },
        { label: getOpenLabel('in Incognito window'), action: () => handleOpen('incognito') },
    ];

    return { contextMenu, handleContextMenu, closeContextMenu, menuItems };
}
