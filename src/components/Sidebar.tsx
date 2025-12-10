import React from 'react';
import { Folder } from 'lucide-react';

interface SidebarProps {
    folders: chrome.bookmarks.BookmarkTreeNode[];
    selectedFolderId: string;
    onSelectFolder: (id: string) => void;
    onUpdateThumbnails: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ folders, selectedFolderId, onSelectFolder, onUpdateThumbnails }) => {
    const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set(['1'])); // Default expand Bookmarks Bar

    const toggleExpand = (e: React.MouseEvent, folderId: string) => {
        e.stopPropagation();
        const newExpanded = new Set(expandedFolders);
        if (newExpanded.has(folderId)) {
            newExpanded.delete(folderId);
        } else {
            newExpanded.add(folderId);
        }
        setExpandedFolders(newExpanded);
    };

    const renderTree = (nodes: chrome.bookmarks.BookmarkTreeNode[], depth = 0) => {
        return nodes.map((node) => {
            // Only show folders in sidebar
            if (node.url) return null;

            const isSelected = node.id === selectedFolderId;
            const hasChildren = node.children && node.children.some(child => !child.url); // Only care if it has sub-folders
            const isExpanded = expandedFolders.has(node.id);

            return (
                <div key={node.id}>
                    <div
                        className={`sidebar-item ${isSelected ? 'selected' : ''}`}
                        style={{ '--depth': depth } as React.CSSProperties}
                        onClick={() => onSelectFolder(node.id)}
                    >
                        <div
                            className={`arrow-container ${hasChildren ? 'visible' : ''}`}
                            onClick={(e) => hasChildren && toggleExpand(e, node.id)}
                        >
                            {hasChildren && (
                                <svg viewBox="0 0 20 20" className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>
                                    <path d="M6 6L14 10L6 14V6Z" fill="currentColor" />
                                </svg>
                            )}
                        </div>

                        <div className="folder-icon-wrapper">
                            <Folder size={18} fill={isSelected ? "currentColor" : "none"} />
                        </div>
                        <span className="folder-name">{node.title || 'Root'}</span>
                    </div>
                    {hasChildren && isExpanded && node.children && renderTree(node.children, depth + 1)}
                </div>
            );
        });
    };

    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <div>Folders</div>
                <button className="update-btn" onClick={onUpdateThumbnails} title="Update missing thumbnails">
                    ↻
                </button>
            </div>
            <div className="sidebar-content">
                {renderTree(folders)}
            </div>
        </div>
    );
};
