// SPDX-License-Identifier: AGPL-3.0-only
//
// Bookmark subtree helpers shared by paste (popup) and Trash restore (service
// worker). DOM-free. Creation is sequential, parents first, in saved order, so
// a recreated folder keeps its children's order.

import type { SavedNode } from './trash_store';

export type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;

/** Root of Chrome's bookmark tree; its children are the permanent folders. */
export const ROOT_ID = '0';

export function toSavedNode(node: BookmarkNode): SavedNode {
    const saved: SavedNode = { oldId: node.id, title: node.title ?? '' };
    if (node.url) saved.url = node.url;
    if (node.dateAdded !== undefined) saved.dateAdded = node.dateAdded;
    if (!node.url) saved.children = (node.children ?? []).map(toSavedNode);
    return saved;
}

/** The node, or undefined when it no longer exists. */
export async function getNode(id: string): Promise<BookmarkNode | undefined> {
    try {
        const r = await chrome.bookmarks.get(id);
        return r[0];
    } catch {
        return undefined;
    }
}

/**
 * Ancestors of a node, root first, ending with its direct parent. The tree root
 * ('0') is not included, so the first item is a permanent folder.
 */
export async function getAncestors(
    node: BookmarkNode,
    /** Optional lookup cache shared across calls (many siblings share ancestors). */
    cache?: Map<string, BookmarkNode | undefined>,
): Promise<BookmarkNode[]> {
    const chain: BookmarkNode[] = [];
    let parentId = node.parentId;
    let guard = 0;
    while (parentId && parentId !== ROOT_ID && guard++ < 256) {
        let parent: BookmarkNode | undefined;
        if (cache?.has(parentId)) {
            parent = cache.get(parentId);
        } else {
            parent = await getNode(parentId);
            cache?.set(parentId, parent);
        }
        if (!parent) break;
        chain.unshift(parent);
        parentId = parent.parentId;
    }
    return chain;
}

/** Permanent folder (child of the tree root) containing the node, or the node itself. */
export async function getPermanentRoot(node: BookmarkNode): Promise<BookmarkNode> {
    if (!node.parentId || node.parentId === ROOT_ID) return node;
    const chain = await getAncestors(node);
    return chain[0] ?? node;
}

export function isPermanent(node: BookmarkNode): boolean {
    return !node.parentId || node.parentId === ROOT_ID;
}

export function isManaged(node: BookmarkNode): boolean {
    return node.unmodifiable === 'managed';
}

export interface CreateSubtreeOptions {
    /** Position of the root inside the parent; clamped to the parent's child count. */
    index?: number;
    /** Return an existing node to reuse instead of creating one (resume after a crash). */
    findExisting?: (parentId: string, saved: SavedNode) => Promise<BookmarkNode | undefined> | BookmarkNode | undefined;
    /** Called after each node is created or reused. */
    onNode?: (saved: SavedNode, node: BookmarkNode, created: boolean) => Promise<void> | void;
}

async function clampIndex(parentId: string, index: number | undefined): Promise<number | undefined> {
    if (index === undefined) return undefined;
    try {
        const children = await chrome.bookmarks.getChildren(parentId);
        return Math.max(0, Math.min(index, children.length));
    } catch {
        return undefined;
    }
}

/** Recreate a saved subtree under `parentId`. Returns the new (or reused) root. */
export async function createSubtree(
    saved: SavedNode,
    parentId: string,
    opts: CreateSubtreeOptions = {},
): Promise<BookmarkNode> {
    const create = async (node: SavedNode, pid: string, index?: number): Promise<BookmarkNode> => {
        const existing = opts.findExisting ? await opts.findExisting(pid, node) : undefined;
        let result: BookmarkNode;
        let created = false;
        if (existing) {
            result = existing;
        } else {
            const details: chrome.bookmarks.CreateDetails = { parentId: pid, title: node.title };
            if (node.url) details.url = node.url;
            const at = await clampIndex(pid, index);
            if (at !== undefined) details.index = at;
            result = await chrome.bookmarks.create(details);
            created = true;
        }
        if (opts.onNode) await opts.onNode(node, result, created);
        if (!node.url) {
            for (const child of node.children ?? []) await create(child, result.id);
        }
        return result;
    };
    return create(saved, parentId, opts.index);
}
