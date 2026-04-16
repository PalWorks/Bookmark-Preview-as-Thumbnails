import { useState } from 'react';

interface ContextMenuDeps {
    selectedFolderId: string;
    currentFolderId: string | undefined;
    refreshTree: () => void;
    refreshCurrentFolder: (folderId: string) => void;
    onTriggerCapture: (urls: string[]) => void;
    clipboard: { mode: 'cut' | 'copy'; node: chrome.bookmarks.BookmarkTreeNode } | null;
    onCut: (targetId: string) => void;
    onCopy: (targetId: string) => void;
    onPaste: (targetParentId: string) => Promise<void>;
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
}: ContextMenuDeps) {
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean;
        x: number;
        y: number;
        targetId: string;
        type: 'folder' | 'bookmark';
        itemCount?: number;
    }>({ visible: false, x: 0, y: 0, targetId: '', type: 'bookmark' });

    const handleContextMenu = (e: React.MouseEvent, node: chrome.bookmarks.BookmarkTreeNode) => {
        e.preventDefault();
        if (!node.url) {
            chrome.bookmarks.getChildren(node.id, (children) => {
                setContextMenu({
                    visible: true, x: e.clientX, y: e.clientY,
                    targetId: node.id, type: 'folder',
                    itemCount: children.filter(c => c.url).length,
                });
            });
        } else {
            setContextMenu({
                visible: true, x: e.clientX, y: e.clientY,
                targetId: node.id, type: 'bookmark',
            });
        }
    };

    const closeContextMenu = () => setContextMenu(prev => ({ ...prev, visible: false }));

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
        const { targetId, type } = contextMenu;
        if (!confirm('Are you sure you want to delete this item?')) return;
        if (type === 'folder') {
            chrome.bookmarks.removeTree(targetId, () => {
                refreshTree();
                if (currentFolderId) refreshCurrentFolder(currentFolderId);
            });
        } else {
            chrome.bookmarks.remove(targetId, () => {
                if (currentFolderId) refreshCurrentFolder(currentFolderId);
            });
        }
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

    const menuItems = [
        { label: 'Rename', action: handleRename },
        { label: 'Delete', action: handleDelete, danger: true },
        { separator: true, label: '', action: () => {} },
        { label: 'Regenerate Preview', action: handleRegenerate, disabled: contextMenu.type === 'folder' },
        { separator: true, label: '', action: () => {} },
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
        { separator: true, label: '', action: () => {} },
        { label: getOpenLabel('in new tab'), action: () => handleOpen('tab') },
        { label: getOpenLabel('in new window'), action: () => handleOpen('window') },
        { label: getOpenLabel('in Incognito window'), action: () => handleOpen('incognito') },
    ];

    return { contextMenu, handleContextMenu, closeContextMenu, menuItems };
}
