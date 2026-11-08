// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { createSubtree, toSavedNode } from '../../lib/bookmark_tree';

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

    // targetParentId is computed by the caller (useContextMenu) from contextMenu state
    const handlePaste = async (targetParentId: string) => {
        if (!clipboard) return;
        if (clipboard.mode === 'cut') {
            // Await the move so the refresh runs after it completes — matching the
            // copy branch and ensuring callers can await a settled paste.
            await new Promise<void>((resolve) => {
                chrome.bookmarks.move(clipboard.node.id, { parentId: targetParentId }, () => {
                    setClipboard(null);
                    resolve();
                });
            });
            refreshTree();
            refreshCurrentFolder(selectedFolderId);
        } else if (clipboard.mode === 'copy') {
            // Sequential, parents first: children keep their order (a parallel
            // create would shuffle them).
            await createSubtree(toSavedNode(clipboard.node), targetParentId);
            refreshTree();
            refreshCurrentFolder(selectedFolderId);
        }
    };

    return { clipboard, handleCut, handleCopy, handlePaste };
}
