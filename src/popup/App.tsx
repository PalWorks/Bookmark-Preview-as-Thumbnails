import { useEffect, useState, useMemo } from 'react';
import './App.css';
import { db } from '../lib/indexeddb';
import { Sidebar } from '../components/Sidebar';
import { MainContent } from '../components/MainContent';
import { TopBar } from '../components/TopBar';
import { ContextMenu } from '../components/ContextMenu';

function App() {
    const [bookmarkTree, setBookmarkTree] = useState<chrome.bookmarks.BookmarkTreeNode[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string>('1'); // Default to Bookmarks Bar usually '1'
    const [currentFolder, setCurrentFolder] = useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

    // Fetch full bookmark tree
    useEffect(() => {
        chrome.bookmarks.getTree((tree) => {
            const root = tree[0];
            setBookmarkTree(root.children || []);

            // Try to select Bookmarks Bar ('1') first, otherwise the first available folder
            if (root.children && root.children.length > 0) {
                const bar = root.children.find(node => node.id === '1');
                if (bar) {
                    setSelectedFolderId(bar.id);
                } else {
                    setSelectedFolderId(root.children[0].id);
                }
            }
        });
    }, []);

    // Update current folder when selection changes
    useEffect(() => {
        if (!selectedFolderId) return;
        chrome.bookmarks.getSubTree(selectedFolderId, (results) => {
            if (results && results.length > 0) {
                setCurrentFolder(results[0]);
            }
        });
    }, [selectedFolderId]);

    // Load thumbnails for the current folder is handled in the next useEffect


    const [queuedUrls, setQueuedUrls] = useState<Set<string>>(new Set());
    const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set());

    // Listen for thumbnail updates
    useEffect(() => {
        const listener = (message: any) => {
            if (message.type === 'CAPTURE_STARTED' && message.url) {
                // Move from queued to loading
                setQueuedUrls(prev => {
                    const next = new Set(prev);
                    next.delete(message.url);
                    return next;
                });
                setLoadingUrls(prev => {
                    const next = new Set(prev);
                    next.add(message.url);
                    return next;
                });
            } else if (message.type === 'THUMBNAIL_UPDATED' && message.url) {
                // Update thumbnail in state
                db.getThumbnail(message.url).then(thumb => {
                    if (thumb && thumb.blob) {
                        setThumbnails(prev => ({
                            ...prev,
                            [message.url]: URL.createObjectURL(thumb.blob)
                        }));
                        // Remove from loading
                        setLoadingUrls(prev => {
                            const next = new Set(prev);
                            next.delete(message.url);
                            return next;
                        });
                    }
                });
            } else if (message.type === 'CAPTURE_FAILED' && message.url) {
                // Remove from loading if failed
                setLoadingUrls(prev => {
                    const next = new Set(prev);
                    next.delete(message.url);
                    return next;
                });
                console.warn('Capture failed for', message.url, message.error);
                console.log('Removed from loadingUrls:', message.url);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // Load thumbnails when folder changes, then trigger capture for missing ones
    useEffect(() => {
        const loadThumbsAndCapture = async () => {
            if (!currentFolder || !currentFolder.children) return;

            // 1. Load existing thumbnails
            const newThumbs: Record<string, string> = {};
            const existingUrls = new Set<string>();

            for (const node of currentFolder.children) {
                if (node.url) {
                    const thumb = await db.getThumbnail(node.url);
                    if (thumb && thumb.blob) {
                        newThumbs[node.url] = URL.createObjectURL(thumb.blob);
                        existingUrls.add(node.url);
                    }
                }
            }
            setThumbnails(prev => ({ ...prev, ...newThumbs }));

            // 2. Identify missing thumbnails
            // Only auto-capture if we haven't tried recently or if explicitly requested?
            // For now, let's just capture what's missing from DB.
            const missingUrls: string[] = [];
            for (const node of currentFolder.children) {
                if (node.url && !existingUrls.has(node.url)) {
                    // Check if already queued or loading to avoid duplicates
                    if (!loadingUrls.has(node.url) && !queuedUrls.has(node.url)) {
                        missingUrls.push(node.url);
                    }
                }
            }

            // 3. Trigger batch capture if needed
            // 3. Trigger batch capture if needed
            if (missingUrls.length > 0) {
                console.log('Found missing thumbnails:', missingUrls);
                // Auto-capture DISABLED. User must manually trigger.
                // We could optionally update some state to show a "Capture Needed" badge.
            }
        };

        loadThumbsAndCapture();
    }, [currentFolder]); // Only run when folder changes

    const handleConnectFolder = async () => {
        try {
            // Dynamically import fsAccess to avoid issues if not supported
            const { fsAccess } = await import('../lib/fsaccess');
            await fsAccess.chooseDirectory();
            alert('Folder connected successfully! Future thumbnails will be saved to disk.');
        } catch (err) {
            console.error('Error connecting folder:', err);
            // Ignore abort error
            if ((err as Error).name !== 'AbortError') {
                alert('Error connecting folder. See console for details.');
            }
        }
    };

    // Auto-trigger batch capture (optional, but requested implicitly by "whenever I click a folder")
    // We can hook this into the MainContent or here. 
    // Let's pass a callback to MainContent to set loading state.

    const handleBatchCaptureTrigger = (urls: string[]) => {
        setQueuedUrls(prev => {
            const next = new Set(prev);
            urls.forEach(url => next.add(url));
            return next;
        });
        chrome.runtime.sendMessage({ type: 'BATCH_CAPTURE', urls });
    };

    const [useIncognito, setUseIncognito] = useState(false);

    // Load settings
    useEffect(() => {
        chrome.storage.sync.get(['useIncognito'], (result) => {
            setUseIncognito(!!result.useIncognito);
        });
    }, []);

    const handleToggleIncognito = (value: boolean) => {
        if (value) {
            chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
                if (!isAllowed) {
                    // Open extensions page
                    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
                    alert("Please enable 'Allow in Incognito' for this extension to capture private screenshots.\n\nNote: Chrome prevents us from highlighting the specific setting, but it's usually near the bottom.");
                    // We still allow setting the state, as the user might be about to enable it.
                    // Or we could choose to NOT set it until they enable it.
                    // Let's set it, so the UI reflects their intent, but it won't work until they enable it.
                }
                setUseIncognito(value);
                chrome.storage.sync.set({ useIncognito: value });
            });
        } else {
            setUseIncognito(value);
            chrome.storage.sync.set({ useIncognito: value });
        }
    };

    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'folders' | 'bookmarks'>('all');
    const [sortOrder, setSortOrder] = useState<'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest' | 'domain-asc' | 'domain-desc'>('name-asc');
    const [searchResults, setSearchResults] = useState<chrome.bookmarks.BookmarkTreeNode[]>([]);

    // Search Effect
    useEffect(() => {
        if (searchQuery.length > 2) {
            chrome.bookmarks.search(searchQuery, (results) => {
                setSearchResults(results);
            });
        } else {
            setSearchResults([]);
        }
    }, [searchQuery]);

    // Helper to extract domain
    const getDomain = (url?: string) => {
        if (!url) return '';
        try {
            const hostname = new URL(url).hostname;
            return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
        } catch {
            return '';
        }
    };

    // Filter and Sort Logic
    const displayedNodes = useMemo(() => {
        let nodes: chrome.bookmarks.BookmarkTreeNode[] = [];

        if (searchQuery.length > 2) {
            nodes = searchResults;
        } else if (currentFolder && currentFolder.children) {
            nodes = currentFolder.children;
        }

        // Filter
        if (filterType === 'folders') {
            nodes = nodes.filter(node => !node.url);
        } else if (filterType === 'bookmarks') {
            nodes = nodes.filter(node => node.url);
        }

        // Sort
        return [...nodes].sort((a, b) => {
            const aIsFolder = !a.url;
            const bIsFolder = !b.url;

            // Folders always first for Name and Domain sorts
            if (sortOrder.startsWith('name') || sortOrder.startsWith('domain')) {
                if (aIsFolder && !bIsFolder) return -1;
                if (!aIsFolder && bIsFolder) return 1;
            }

            switch (sortOrder) {
                case 'name-asc':
                    return a.title.localeCompare(b.title);
                case 'name-desc':
                    return b.title.localeCompare(a.title);
                case 'date-newest':
                    return (b.dateAdded || 0) - (a.dateAdded || 0);
                case 'date-oldest':
                    return (a.dateAdded || 0) - (b.dateAdded || 0);
                case 'domain-asc': {
                    if (aIsFolder) return a.title.localeCompare(b.title); // Sort folders by title
                    const domainA = getDomain(a.url);
                    const domainB = getDomain(b.url);
                    if (domainA === domainB) return a.title.localeCompare(b.title); // Fallback to title
                    return domainA.localeCompare(domainB);
                }
                case 'domain-desc': {
                    if (aIsFolder) return b.title.localeCompare(a.title);
                    const domainADesc = getDomain(a.url);
                    const domainBDesc = getDomain(b.url);
                    if (domainADesc === domainBDesc) return b.title.localeCompare(a.title);
                    return domainBDesc.localeCompare(domainADesc);
                }
                default:
                    return 0;
            }
        });
    }, [currentFolder, searchResults, searchQuery, filterType, sortOrder]);

    const isCapturing = loadingUrls.size > 0 || queuedUrls.size > 0;

    const handleUpdateThumbnails = () => {
        // Manual trigger to re-capture MISSING thumbnails in current view (Resume)
        // Use displayedNodes to respect current Sort Order and Filter
        if (displayedNodes && displayedNodes.length > 0) {
            // Filter out URLs that already have a thumbnail loaded
            const urls = displayedNodes
                .map(n => n.url)
                .filter(u => u && !thumbnails[u]) as string[];

            if (urls.length > 0) {
                handleBatchCaptureTrigger(urls);
            } else {
                console.log('All thumbnails already captured');
            }
        }
    };

    const handleStopCapture = () => {
        setLoadingUrls(new Set());
        setQueuedUrls(new Set());
        chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
    };

    const handleNavigate = (id: string) => {
        setSelectedFolderId(id);
        setSearchQuery(''); // Clear search on navigation
    };

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
        const type = node.url ? 'bookmark' : 'folder';

        if (type === 'folder') {
            chrome.bookmarks.getChildren(node.id, (children) => {
                // Count only bookmarks (nodes with URLs) for "Open all"
                const count = children.filter(c => c.url).length;
                setContextMenu({
                    visible: true,
                    x: e.clientX,
                    y: e.clientY,
                    targetId: node.id,
                    type: 'folder',
                    itemCount: count
                });
            });
        } else {
            setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                targetId: node.id,
                type: 'bookmark'
            });
        }
    };

    const closeContextMenu = () => {
        setContextMenu(prev => ({ ...prev, visible: false }));
    };

    const handleRename = () => {
        const id = contextMenu.targetId;
        chrome.bookmarks.get(id, (results) => {
            if (results && results.length > 0) {
                const node = results[0];
                const newTitle = prompt('Rename to:', node.title);
                if (newTitle !== null && newTitle !== node.title) {
                    chrome.bookmarks.update(id, { title: newTitle }, () => {
                        // Refresh tree or current folder
                        // Since we don't have a granular refresh, let's just trigger a full tree reload for now
                        // or rely on the fact that we might need to update local state if we want instant feedback without reload
                        // But for now, let's just reload the tree which is simple
                        chrome.bookmarks.getTree((tree) => {
                            setBookmarkTree(tree[0].children || []);
                        });
                        // Also update current folder if needed
                        if (currentFolder && currentFolder.id === selectedFolderId) {
                            chrome.bookmarks.getSubTree(selectedFolderId, (results) => {
                                if (results && results.length > 0) {
                                    setCurrentFolder(results[0]);
                                }
                            });
                        }
                    });
                }
            }
        });
    };

    const handleDelete = () => {
        const id = contextMenu.targetId;
        if (confirm('Are you sure you want to delete this item?')) {
            if (contextMenu.type === 'folder') {
                chrome.bookmarks.removeTree(id, () => {
                    // Refresh
                    chrome.bookmarks.getTree((tree) => {
                        setBookmarkTree(tree[0].children || []);
                    });
                    if (currentFolder) {
                        chrome.bookmarks.getSubTree(selectedFolderId, (results) => {
                            if (results && results.length > 0) {
                                setCurrentFolder(results[0]);
                            }
                        });
                    }
                });
            } else {
                chrome.bookmarks.remove(id, () => {
                    // Refresh
                    if (currentFolder) {
                        chrome.bookmarks.getSubTree(selectedFolderId, (results) => {
                            if (results && results.length > 0) {
                                setCurrentFolder(results[0]);
                            }
                        });
                    }
                });
            }
        }
    };

    const handleOpen = (mode: 'tab' | 'window' | 'incognito') => {
        const id = contextMenu.targetId;
        chrome.bookmarks.get(id, (results) => {
            if (results && results.length > 0) {
                const node = results[0];
                if (node.url) {
                    if (mode === 'tab') {
                        chrome.tabs.create({ url: node.url });
                    } else if (mode === 'window') {
                        chrome.windows.create({ url: node.url });
                    } else if (mode === 'incognito') {
                        chrome.windows.create({ url: node.url, incognito: true });
                    }
                } else {
                    // Open all in folder
                    chrome.bookmarks.getChildren(id, (children) => {
                        const urls = children.filter(c => c.url).map(c => c.url!);
                        if (urls.length > 0) {
                            if (mode === 'tab') {
                                urls.forEach(url => chrome.tabs.create({ url }));
                            } else if (mode === 'window') {
                                chrome.windows.create({ url: urls });
                            } else if (mode === 'incognito') {
                                chrome.windows.create({ url: urls, incognito: true });
                            }
                        }
                    });
                }
            }
        });
    };

    const getOpenLabel = (suffix: string) => {
        if (contextMenu.type === 'folder' && contextMenu.itemCount !== undefined && contextMenu.itemCount > 0) {
            return `Open all (${contextMenu.itemCount}) ${suffix}`;
        }
        return `Open ${suffix}`;
    };

    const menuItems = [
        { label: 'Rename', action: handleRename },
        { label: 'Delete', action: handleDelete, danger: true },
        { separator: true, label: '', action: () => { } },
        { label: getOpenLabel('in new tab'), action: () => handleOpen('tab') },
        { label: getOpenLabel('in new window'), action: () => handleOpen('window') },
        { label: getOpenLabel('in Incognito window'), action: () => handleOpen('incognito') },
    ];

    const handleNavigateBack = () => {
        if (currentFolder && currentFolder.parentId && currentFolder.parentId !== '0') {
            chrome.bookmarks.getSubTree(currentFolder.parentId, (results) => {
                if (results && results.length > 0) {
                    // If parent is root ('0'), we might want to select the first child (usually Bookmarks Bar '1')
                    // But usually getSubTree('0') returns the root node which contains '1', '2', etc.
                    // Let's just set the parent as current.
                    // Wait, if we are at '1' (Bookmarks Bar), parent is '0'. Do we want to go to '0'?
                    // '0' is the invisible root. Usually we don't want to show '0'.
                    // So if parentId is '0', we probably can't go back further in this UI view.
                    setCurrentFolder(results[0]);
                    setSelectedFolderId(results[0].id);
                }
            });
        }
    };

    return (
        <div className="app-container">
            <TopBar
                onSearch={setSearchQuery}
                onConnectFolder={handleConnectFolder}
                useIncognito={useIncognito}
                onToggleIncognito={handleToggleIncognito}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                filterType={filterType}
                onFilterChange={setFilterType}
                sortOrder={sortOrder}
                onSortChange={setSortOrder}
                onUpdateThumbnails={handleUpdateThumbnails}
                onStopCapture={handleStopCapture}
                isCapturing={isCapturing}
            />
            <div className="content-wrapper">
                <Sidebar
                    folders={bookmarkTree}
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={handleNavigate}
                    onContextMenu={handleContextMenu}
                />
                <MainContent
                    folder={currentFolder}
                    displayedNodes={displayedNodes}
                    isSearching={searchQuery.length > 2}
                    searchQuery={searchQuery}
                    thumbnails={thumbnails}
                    loadingUrls={loadingUrls}
                    queuedUrls={queuedUrls}
                    onNavigate={handleNavigate}
                    onNavigateBack={handleNavigateBack}
                    onTriggerBatchCapture={handleBatchCaptureTrigger}
                    viewMode={viewMode}
                    onContextMenu={handleContextMenu}
                />
            </div>
            {contextMenu.visible && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={menuItems}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
}

export default App;
