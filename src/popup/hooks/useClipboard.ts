// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { createSubtree, getNode, toSavedNode } from '../../lib/bookmark_tree';
import { moveNodes, type MoveResult } from '../../lib/bulk_move';

export function useClipboard(
    selectedFolderId: string,
    refreshTree: () => void,
    refreshCurrentFolder: (folderId: string) => void,
    /** Cut and Paste finished: the page shows the result with Undo. */
    onMoved?: (result: MoveResult, targetId: string) => void,
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
            // Same path as bulk Move to: records the original place for Undo and
            // refuses a folder into itself or Chrome's own folders with a reason.
            let result: MoveResult;
            try {
                result = await moveNodes([clipboard.node.id], targetParentId);
            } catch (err) {
                console.error('[Paste] move failed', err);
                result = { moved: [], failed: [{ id: clipboard.node.id, title: clipboard.node.title, reason: "Couldn't move it. Nothing was changed." }] };
            }
            // A refused move keeps the clipboard so the user can paste elsewhere,
            // unless the cut item itself is gone.
            if (result.moved.length || !(await getNode(clipboard.node.id))) setClipboard(null);
            refreshTree();
            refreshCurrentFolder(selectedFolderId);
            onMoved?.(result, targetParentId);
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
