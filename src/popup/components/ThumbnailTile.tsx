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
}

const ThumbnailTile: React.FC<ThumbnailTileProps> = ({ bookmark }) => {
    return (
        <div className="tile" tabIndex={0}>
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
