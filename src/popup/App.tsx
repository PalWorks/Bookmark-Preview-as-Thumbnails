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

    const handleUpdateThumbnails = async () => {
        // Collect all URLs from the current folder that are missing thumbnails
        // In a real implementation, this should probably traverse the whole tree or let user select
        // For now, let's just update the current folder's missing thumbnails
        if (!currentFolder || !currentFolder.children) return;

        const urlsToCapture: string[] = [];
        for (const node of currentFolder.children) {
            if (node.url && !thumbnails[node.url]) {
                urlsToCapture.push(node.url);
            }
        }

        if (urlsToCapture.length === 0) {
            alert('No missing thumbnails in this folder.');
            return;
        }

        if (confirm(`Update ${urlsToCapture.length} thumbnails? This will open tabs in the background.`)) {
            chrome.runtime.sendMessage({ type: 'BATCH_CAPTURE', urls: urlsToCapture });
        }
    };

    return (
        <div className="app-container">
            <TopBar onSearch={(q) => console.log('Search:', q)} />
            <div className="content-wrapper">
                <Sidebar
                    folders={bookmarkTree}
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={setSelectedFolderId}
                    onUpdateThumbnails={handleUpdateThumbnails}
                />
                <MainContent
                    folder={currentFolder}
                    thumbnails={thumbnails}
                    onNavigate={setSelectedFolderId}
                />
            </div>
        </div>
    );
}

export default App;
