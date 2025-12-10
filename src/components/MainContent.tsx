import React from 'react';
import { Folder } from 'lucide-react';
import ThumbnailTile from '../popup/components/ThumbnailTile';

interface MainContentProps {
    folder: chrome.bookmarks.BookmarkTreeNode | null;
    displayedNodes?: chrome.bookmarks.BookmarkTreeNode[]; // Optional for backward compatibility, but we'll use it
    isSearching?: boolean;
    searchQuery?: string;
    thumbnails: Record<string, string>; // Map URL -> Blob URL
    loadingUrls: Set<string>;
    queuedUrls: Set<string>;
    onNavigate: (id: string) => void;
    onTriggerBatchCapture: (urls: string[]) => void;
    viewMode: 'grid' | 'list';
}

export const MainContent: React.FC<MainContentProps> = ({
    folder,
    displayedNodes,
    isSearching,
    searchQuery,
    thumbnails,
    loadingUrls,
    queuedUrls,
    onNavigate,
    viewMode
}) => {
    // Logic for triggering capture is now handled in App.tsx to avoid race conditions
    // and ensure thumbnails are loaded first.

    // Use displayedNodes if provided, otherwise fallback to folder.children (or empty)
    const nodesToDisplay = displayedNodes || folder?.children || [];

    if (!folder && !isSearching) return <div className="main-empty">Select a folder</div>;

    return (
        <div className={`main-content ${viewMode === 'list' ? 'list-view' : ''}`}>
            <header className="main-header">
                <h2>{isSearching ? `Search Results for "${searchQuery}"` : folder?.title}</h2>
            </header>
            <div className={viewMode === 'grid' ? 'grid' : 'list-container'}>
                {nodesToDisplay.map((node) => {
                    if (node.url) {
                        // Bookmark
                        if (viewMode === 'list') {
                            return (
                                <div key={node.id} className="list-item">
                                    <div className="list-item-thumb">
                                        {thumbnails[node.url] ? (
                                            <img src={thumbnails[node.url]} alt={node.title} />
                                        ) : (
                                            <div className="list-thumb-placeholder"></div>
                                        )}
                                    </div>
                                    <div className="list-item-info">
                                        <a href={node.url} target="_blank" rel="noopener noreferrer" className="list-item-title">
                                            {node.title || node.url}
                                        </a>
                                        <span className="list-item-url">{node.url}</span>
                                    </div>
                                    <div className="list-item-status">
                                        {loadingUrls.has(node.url) && <span className="status-loading">Loading...</span>}
                                        {queuedUrls.has(node.url) && <span className="status-queued">Waiting...</span>}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <ThumbnailTile
                                key={node.id}
                                bookmark={{
                                    id: node.id,
                                    url: node.url,
                                    title: node.title,
                                    thumbnailUrl: thumbnails[node.url]
                                }}
                                isLoading={loadingUrls.has(node.url)}
                                isQueued={queuedUrls.has(node.url)}
                            />
                        );
                    } else {
                        // Folder
                        if (viewMode === 'list') {
                            return (
                                <div
                                    key={node.id}
                                    className="list-item folder-list-item"
                                    onClick={() => onNavigate(node.id)}
                                >
                                    <Folder size={20} className="list-folder-icon" />
                                    <span className="list-item-title">{node.title}</span>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={node.id}
                                className="folder-tile"
                                onClick={() => onNavigate(node.id)}
                            >
                                <Folder size={48} className="folder-icon" />
                                <span className="folder-label">{node.title}</span>
                            </div>
                        );
                    }
                })}
                {nodesToDisplay.length === 0 && (
                    <div className="empty-state">
                        <p>{isSearching ? 'No results found.' : 'This folder is empty.'}</p>
                        {!isSearching && <p className="sub-text">Add bookmarks to see them here.</p>}
                    </div>
                )}
            </div>
        </div>
    );
};
