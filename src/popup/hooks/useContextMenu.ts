// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';

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
        const opener = e.currentTarget as HTMLElement | null;
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
            if (newTitle !== null && newTitle !== results[0].title) {
                chrome.bookmarks.update(targetId, { title: newTitle }, () => {
                    refreshTree();
                    if (currentFolderId) refreshCurrentFolder(currentFolderId);
                });
            }
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
                if (mode === 'tab') chrome.tabs.create({ url: node.url });
                else if (mode === 'window') chrome.windows.create({ url: node.url });
                else chrome.windows.create({ url: node.url, incognito: true });
            } else {
                chrome.bookmarks.getChildren(targetId, (children) => {
                    const urls = children.filter(c => c.url).map(c => c.url!);
                    if (!urls.length) return;
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
            if (node.url) {
                onTriggerCapture([node.url]);
            } else {
                alert('Regeneration is currently only supported for individual bookmarks.');
            }
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
    const menuItems = [
        { label: 'Rename', action: handleRename },
        { label: 'Delete', action: handleDelete, danger: true, disabled: !canDelete || contextMenu.permanent },
        { separator: true, label: '', action: () => { } },
        { label: 'Regenerate Preview', action: handleRegenerate, disabled: contextMenu.type === 'folder' },
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
