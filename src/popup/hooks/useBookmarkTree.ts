// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildParentMap, isInHiddenFolder } from '../../lib/folder_prefs';

// Chrome's permanent ID for the "Bookmarks bar" folder
const BOOKMARKS_BAR_ID = '1';
/** Bursts of bookmark events (a folder delete, a restore) refresh once per this window. */
const REFRESH_COALESCE_MS = 150;

type Node = chrome.bookmarks.BookmarkTreeNode;

async function exists(id: string): Promise<boolean> {
    try {
        return (await chrome.bookmarks.get(id)).length > 0;
    } catch {
        return false;
    }
}

/** Parent chain of a folder, nearest first, excluding the tree root. */
async function ancestorIds(id: string): Promise<string[]> {
    const out: string[] = [];
    let cur = id;
    for (let guard = 0; guard < 256; guard++) {
        let node: Node | undefined;
        try { node = (await chrome.bookmarks.get(cur))[0]; } catch { break; }
        if (!node?.parentId || node.parentId === '0') break;
        out.push(node.parentId);
        cur = node.parentId;
    }
    return out;
}

/**
 * Bookmark tree, selected folder and search. Subscribes to Chrome's bookmark
 * events, so changes made anywhere (this page, another tab, Chrome's bookmark
 * manager, sync, a Trash restore) show up without a reload.
 */
export function useBookmarkTree(
    /** Folders hidden from search (folder prefs). */
    hiddenFolderIds: Set<string> = new Set(),
) {
    const [bookmarkTree, setBookmarkTree] = useState<Node[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string>(BOOKMARKS_BAR_ID);
    const [currentFolder, setCurrentFolder] = useState<Node | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Node[]>([]);
    // Matches inside hidden folders, and whether the user asked to see them for this query.
    const [hiddenResults, setHiddenResults] = useState<Node[]>([]);
    const [includeHiddenFor, setIncludeHiddenFor] = useState<string | null>(null);
    const hiddenKey = useMemo(() => [...hiddenFolderIds].sort().join(','), [hiddenFolderIds]);
    // Bumped (coalesced) by bookmark events; every read below re-runs on it.
    const [treeRev, setTreeRev] = useState(0);

    const initialised = useRef(false);
    // Ancestors of the selected folder, so a deleted folder falls back to the
    // nearest one that still exists.
    const selectedAncestors = useRef<string[]>([]);

    // Full tree (sidebar).
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const tree = await chrome.bookmarks.getTree();
            if (cancelled) return;
            const roots = tree[0]?.children ?? [];
            setBookmarkTree(roots);
            if (!initialised.current && roots.length > 0) {
                initialised.current = true;
                const bar = roots.find(n => n.id === BOOKMARKS_BAR_ID);
                setSelectedFolderId(bar ? bar.id : roots[0].id);
            }
        };
        load().catch(err => console.error('[Bookmarks] tree load failed', err));
        return () => { cancelled = true; };
    }, [treeRev]);

    // Remember where the selected folder lives.
    useEffect(() => {
        let cancelled = false;
        const track = async () => {
            const chain = await ancestorIds(selectedFolderId);
            if (!cancelled && chain.length) selectedAncestors.current = chain;
        };
        void track();
        return () => { cancelled = true; };
    }, [selectedFolderId]);

    // Current folder contents; if the folder is gone, move to its nearest surviving ancestor.
    useEffect(() => {
        if (!selectedFolderId) return;
        let cancelled = false;
        const load = async () => {
            let results: Node[] | undefined;
            try {
                results = await chrome.bookmarks.getSubTree(selectedFolderId);
            } catch {
                results = undefined;
            }
            if (cancelled) return;
            if (results && results.length > 0) {
                setCurrentFolder(results[0]);
                return;
            }
            for (const id of selectedAncestors.current) {
                if (await exists(id)) {
                    if (!cancelled) setSelectedFolderId(id);
                    return;
                }
            }
            if (await exists(BOOKMARKS_BAR_ID)) {
                if (!cancelled) setSelectedFolderId(BOOKMARKS_BAR_ID);
                return;
            }
            const tree = await chrome.bookmarks.getTree().catch(() => [] as Node[]);
            const first = tree[0]?.children?.[0]?.id;
            if (!cancelled && first && first !== selectedFolderId) setSelectedFolderId(first);
        };
        void load();
        return () => { cancelled = true; };
    }, [selectedFolderId, treeRev]);

    // Search, re-run when bookmarks change. Matches inside folders hidden from search
    // are held apart; the parent map is read in the same pass so it is never stale.
    useEffect(() => {
        if (searchQuery.length > 2) {
            let cancelled = false;
            const hidden = new Set(hiddenKey ? hiddenKey.split(',') : []);
            const run = async () => {
                const results = await chrome.bookmarks.search(searchQuery);
                let visible = results;
                let held: Node[] = [];
                if (hidden.size) {
                    const tree = await chrome.bookmarks.getTree();
                    const parentOf = buildParentMap(tree);
                    visible = results.filter(n => !isInHiddenFolder(n.id, parentOf, hidden));
                    held = results.filter(n => isInHiddenFolder(n.id, parentOf, hidden));
                }
                if (cancelled) return;
                setSearchResults(visible);
                setHiddenResults(held);
            };
            run().catch(() => { if (!cancelled) { setSearchResults([]); setHiddenResults([]); } });
            return () => { cancelled = true; };
        }
        // Benign one-shot reset when the query drops below the search threshold.
        // Not a cascading render (fires only on query change) and this state
        // isn't even read while the query is short — see App.tsx displayedNodes.
        setSearchResults([]);
        setHiddenResults([]);
        return undefined;
    }, [searchQuery, treeRev, hiddenKey]);

    // "Show them" applies to the query it was pressed for only.
    const includeHidden = includeHiddenFor !== null && includeHiddenFor === searchQuery;

    // Bookmark events → one refresh per burst; paused during a bookmark import.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let importing = false;
        const schedule = () => {
            if (importing || timer) return;
            timer = setTimeout(() => {
                timer = null;
                setTreeRev(n => n + 1);
            }, REFRESH_COALESCE_MS);
        };
        const onImportBegan = () => { importing = true; };
        const onImportEnded = () => { importing = false; schedule(); };
        const b = chrome.bookmarks;
        b.onCreated.addListener(schedule);
        b.onRemoved.addListener(schedule);
        b.onChanged.addListener(schedule);
        b.onMoved.addListener(schedule);
        b.onChildrenReordered.addListener(schedule);
        b.onImportBegan.addListener(onImportBegan);
        b.onImportEnded.addListener(onImportEnded);
        return () => {
            if (timer) clearTimeout(timer);
            b.onCreated.removeListener(schedule);
            b.onRemoved.removeListener(schedule);
            b.onChanged.removeListener(schedule);
            b.onMoved.removeListener(schedule);
            b.onChildrenReordered.removeListener(schedule);
            b.onImportBegan.removeListener(onImportBegan);
            b.onImportEnded.removeListener(onImportEnded);
        };
    }, []);

    const handleNavigate = (id: string) => {
        setSelectedFolderId(id);
        setSearchQuery(''); // Clear search on folder navigation
    };

    const handleNavigateBack = () => {
        if (currentFolder?.parentId && currentFolder.parentId !== '0') {
            // Just update selectedFolderId — the effect above handles setCurrentFolder
            setSelectedFolderId(currentFolder.parentId);
        }
    };

    /** Re-read everything now (event listeners already cover changes made through Chrome). */
    const refreshTree = () => setTreeRev(n => n + 1);

    return {
        bookmarkTree,
        selectedFolderId,
        currentFolder,
        searchQuery,
        setSearchQuery,
        /** Visible matches, plus the hidden ones when the user chose to see them. */
        searchResults: includeHidden ? [...searchResults, ...hiddenResults] : searchResults,
        /** Matches inside hidden folders that are not shown. */
        hiddenResultCount: includeHidden ? 0 : hiddenResults.length,
        showHiddenResults: () => setIncludeHiddenFor(searchQuery),
        handleNavigate,
        handleNavigateBack,
        refreshTree,
        /** Kept for callers that refresh one folder; the whole view refreshes together. */
        refreshCurrentFolder: (_folderId?: string) => refreshTree(),
    };
}
