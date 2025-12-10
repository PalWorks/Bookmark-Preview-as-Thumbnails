import React from 'react';
import { Folder } from 'lucide-react';
import ThumbnailTile from '../popup/components/ThumbnailTile';

interface MainContentProps {
    folder: chrome.bookmarks.BookmarkTreeNode | null;
    thumbnails: Record<string, string>; // Map URL -> Blob URL
    onNavigate: (id: string) => void;
}

export const MainContent: React.FC<MainContentProps> = ({ folder, thumbnails, onNavigate }) => {
    if (!folder) return <div className="main-empty">Select a folder</div>;

    console.log('Rendering folder:', folder.title, 'Children:', folder.children?.length);

    return (
        <div className="main-content">
            <header className="main-header">
                <h2>{folder.title}</h2>
            </header>
            <div className="grid">
                {folder.children
                    ?.sort((a, b) => {
                        // Sort folders first, then bookmarks
                        const aIsFolder = !a.url;
                        const bIsFolder = !b.url;
                        if (aIsFolder && !bIsFolder) return -1;
                        if (!aIsFolder && bIsFolder) return 1;
                        return 0;
                    })
                    .map((node) => {
                        if (node.url) {
                            // Bookmark
                            return (
                                <ThumbnailTile
                                    key={node.id}
                                    bookmark={{
                                        id: node.id,
                                        url: node.url,
                                        title: node.title,
                                        thumbnailUrl: thumbnails[node.url]
                                    }}
                                />
                            );
                        } else {
                            // Folder
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
                {(!folder.children || folder.children.length === 0) && (
                    <div className="empty-state">
                        <p>This folder is empty.</p>
                        <p className="sub-text">Add bookmarks to see them here.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
