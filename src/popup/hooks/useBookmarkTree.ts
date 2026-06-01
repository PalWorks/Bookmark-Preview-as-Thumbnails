import { useEffect, useState } from 'react';

// Chrome's permanent ID for the "Bookmarks bar" folder
const BOOKMARKS_BAR_ID = '1';

export function useBookmarkTree() {
    const [bookmarkTree, setBookmarkTree] = useState<chrome.bookmarks.BookmarkTreeNode[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string>(BOOKMARKS_BAR_ID);
    const [currentFolder, setCurrentFolder] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<chrome.bookmarks.BookmarkTreeNode[]>([]);

    // Fetch full bookmark tree on mount and select Bookmarks Bar by default
    useEffect(() => {
        chrome.bookmarks.getTree((tree) => {
            const root = tree[0];
            setBookmarkTree(root.children || []);
            if (root.children && root.children.length > 0) {
                const bar = root.children.find(n => n.id === BOOKMARKS_BAR_ID);
                setSelectedFolderId(bar ? bar.id : root.children[0].id);
            }
        });
    }, []);

    // Update current folder whenever the selected folder ID changes
    useEffect(() => {
        if (!selectedFolderId) return;
        chrome.bookmarks.getSubTree(selectedFolderId, (results) => {
            if (results && results.length > 0) setCurrentFolder(results[0]);
        });
    }, [selectedFolderId]);

    // Search bookmarks when query changes
    useEffect(() => {
        if (searchQuery.length > 2) {
            chrome.bookmarks.search(searchQuery, (results) => setSearchResults(results));
        } else {
            // Benign one-shot reset when the query drops below the search threshold.
            // Not a cascading render (fires only on query change) and this state
            // isn't even read while the query is short — see App.tsx displayedNodes.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSearchResults([]);
        }
    }, [searchQuery]);

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

    const refreshTree = () => {
        chrome.bookmarks.getTree((tree) => {
            setBookmarkTree(tree[0].children || []);
        });
    };

    const refreshCurrentFolder = (folderId: string) => {
        chrome.bookmarks.getSubTree(folderId, (results) => {
            if (results && results.length > 0) setCurrentFolder(results[0]);
        });
    };

    return {
        bookmarkTree,
        selectedFolderId,
        currentFolder,
        searchQuery,
        setSearchQuery,
        searchResults,
        handleNavigate,
        handleNavigateBack,
        refreshTree,
        refreshCurrentFolder,
    };
}
