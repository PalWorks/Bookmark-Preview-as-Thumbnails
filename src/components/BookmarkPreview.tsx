// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { Folder } from 'lucide-react';
import { faviconUrl, getDomain } from '../lib/utils';

interface BookmarkPreviewProps {
    url: string;
    title: string;
    thumbnailUrl?: string;
    /** tile: grid card; row: list thumbnail; mini: Trash strip. */
    variant?: 'tile' | 'row' | 'mini';
}

/**
 * The captured screenshot when there is one; otherwise the site's icon from
 * Chrome's local favicon cache with the domain under it, so an uncaptured
 * bookmark is still recognisable. Chrome returns a generic globe for unknown
 * sites; the domain text still identifies the bookmark.
 */
export const BookmarkPreview: React.FC<BookmarkPreviewProps> = ({ url, title, thumbnailUrl, variant = 'tile' }) => {
    if (thumbnailUrl) {
        return <img src={thumbnailUrl} alt="" className={`bp-img bp-img--${variant}`} draggable={false} />;
    }
    const size = variant === 'tile' ? 32 : 16;
    const domain = getDomain(url);
    return (
        <div className={`bp-fallback bp-fallback--${variant}`} title={variant === 'tile' ? undefined : title}>
            <img
                src={faviconUrl(url, size)}
                srcSet={`${faviconUrl(url, size * 2)} 2x`}
                width={size}
                height={size}
                alt=""
                loading="lazy"
                draggable={false}
                className="bp-favicon"
            />
            {variant === 'tile' && domain && <span className="bp-domain">{domain}</span>}
        </div>
    );
};

/** Yellow folder icon (tokens --folder-fill / --folder-stroke, 3:1 in both themes). */
export const FolderGlyph: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
    <Folder size={size} className={`folder-glyph ${className}`} aria-hidden="true" focusable="false" />
);
