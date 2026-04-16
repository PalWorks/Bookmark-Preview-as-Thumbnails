import { useState } from 'react';

export function useClipboard(
    selectedFolderId: string,
    refreshTree: () => void,
    refreshCurrentFolder: (folderId: string) => void
) {
    const [clipboard, setClipboard] = useState<{
        mode: 'cut' | 'copy';
        node: chrome.bookmarks.BookmarkTreeNode;
    } | null>(null);

    const handleCut = (targetId: string) => {
        chrome.bookmarks.get(targetId, (results) => {
            if (results && results.length > 0) {
                setClipboard({ mode: 'cut', node: results[0] });
            }
        });
    };

    const handleCopy = (targetId: string) => {
        // Use getSubTree to include children for folder copies
        chrome.bookmarks.getSubTree(targetId, (results) => {
            if (results && results.length > 0) {
                setClipboard({ mode: 'copy', node: results[0] });
            }
        });
    };

    const copyNodeRecursively = async (
        node: chrome.bookmarks.BookmarkTreeNode,
        parentId: string
    ): Promise<void> => {
        const newNode = await chrome.bookmarks.create({
            parentId,
            title: node.title,
            url: node.url,
        });
        if (node.children?.length) {
            await Promise.all(node.children.map(child => copyNodeRecursively(child, newNode.id)));
        }
    };

    // targetParentId is computed by the caller (useContextMenu) from contextMenu state
    const handlePaste = async (targetParentId: string) => {
        if (!clipboard) return;
        if (clipboard.mode === 'cut') {
            chrome.bookmarks.move(clipboard.node.id, { parentId: targetParentId }, () => {
                setClipboard(null);
                refreshTree();
                refreshCurrentFolder(selectedFolderId);
            });
        } else if (clipboard.mode === 'copy') {
            await copyNodeRecursively(clipboard.node, targetParentId);
            refreshTree();
            refreshCurrentFolder(selectedFolderId);
        }
    };

    return { clipboard, handleCut, handleCopy, handlePaste };
}
