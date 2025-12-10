import { useEffect, useState } from 'react';
import './App.css';
import { db } from '../lib/indexeddb';
import { storageIndex } from '../lib/storage_index';
import { Sidebar } from '../components/Sidebar';
import { MainContent } from '../components/MainContent';
import { TopBar } from '../components/TopBar';

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

    // Load thumbnails for the current folder
    useEffect(() => {
        if (!currentFolder || !currentFolder.children) return;

        const loadThumbs = async () => {
            const newThumbnails: Record<string, string> = {};
            const metadata = await storageIndex.getAll();

            for (const node of currentFolder.children || []) {
                if (node.url) {
                    // Check if we have a thumbnail for this URL
                    // We use URL as ID in our storage currently
                    // Find meta by URL (inefficient, but our storage ID is URL)
                    const meta = metadata[node.url];
                    if (meta && (meta.status === 'saved_indexeddb' || meta.status === 'saved_disk')) {
                        const thumb = await db.getThumbnail(node.url);
                        if (thumb && thumb.blob) {
                            newThumbnails[node.url] = URL.createObjectURL(thumb.blob);
                        }
                    }
                }
            }
            setThumbnails(newThumbnails);
        };

        loadThumbs();
    }, [currentFolder]);

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

    return (
        <div className="app-container">
            <TopBar
                onSearch={(q) => console.log('Search:', q)}
                onConnectFolder={handleConnectFolder}
            />
            <div className="content-wrapper">
                <Sidebar
                    folders={bookmarkTree}
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={setSelectedFolderId}
                    onUpdateThumbnails={() => {
                        // Manual trigger to re-capture MISSING thumbnails in current folder (Resume)
                        if (currentFolder && currentFolder.children) {
                            // Filter out URLs that already have a thumbnail loaded
                            const urls = currentFolder.children
                                .map(n => n.url)
                                .filter(u => u && !thumbnails[u]) as string[];

                            if (urls.length > 0) {
                                handleBatchCaptureTrigger(urls);
                            } else {
                                console.log('All thumbnails already captured');
                            }
                        }
                    }}
                    onStopCapture={() => {
                        setLoadingUrls(new Set());
                        setQueuedUrls(new Set());
                        chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
                    }}
                />
                <MainContent
                    folder={currentFolder}
                    thumbnails={thumbnails}
                    loadingUrls={loadingUrls}
                    queuedUrls={queuedUrls}
                    onNavigate={setSelectedFolderId}
                    onTriggerBatchCapture={handleBatchCaptureTrigger}
                />
            </div>
        </div>
    );
}

export default App;
