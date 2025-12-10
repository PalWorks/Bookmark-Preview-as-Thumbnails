import React from 'react';
import './ThumbnailTile.css';

interface BookmarkItem {
    id: string;
    url: string;
    title: string;
    thumbnailUrl?: string;
}

interface ThumbnailTileProps {
    bookmark: BookmarkItem;
    isLoading?: boolean;
    isQueued?: boolean;
}

const ThumbnailTile: React.FC<ThumbnailTileProps> = ({ bookmark, isLoading, isQueued }) => {
    const handleClick = () => {
        chrome.tabs.create({ url: bookmark.url, active: true });
    };

    return (
        <div className="tile" tabIndex={0} onClick={handleClick} onKeyDown={(e) => e.key === 'Enter' && handleClick()}>
            <div className="preview">
                {bookmark.thumbnailUrl ? (
                    <img
                        src={bookmark.thumbnailUrl}
                        alt={bookmark.title}
                        className="preview-img"
                    />
                ) : (
                    <span className="no-preview">No Preview</span>
                )}
                {isLoading && (
                    <div className="loading-overlay">
                        <div className="loading-bar"></div>
                    </div>
                )}
                {isQueued && !isLoading && (
                    <div className="queued-overlay">
                        <span className="queued-text">Waiting...</span>
                    </div>
                )}
            </div>
            <div className="info">
                <div
                    className="tile-title"
                    title={bookmark.title}
                >
                    {bookmark.title}
                </div>
                <div
                    className="tile-url"
                    title={bookmark.url}
                >
                    {bookmark.url}
                </div>
            </div>
        </div>
    );
};

export default ThumbnailTile;
