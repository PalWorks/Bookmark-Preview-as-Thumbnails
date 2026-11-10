// SPDX-License-Identifier: AGPL-3.0-only
//
// Ask AI's preview pane: the bookmarks the AI changed in this chat, then the ones it
// looked at, with their captured previews. Display only: links open only when they are
// http(s), in a new tab, without the opener; a bookmarklet (javascript:) is never a link.

import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import type { ChatItem } from '../popup/hooks/useAskAI';
import { previewEntries, type PreviewEntry as Entry } from '../lib/agent/previews';
import { thumbnailStorage } from '../lib/thumbnail_storage';
import { BookmarkPreview } from './BookmarkPreview';

const safeHref = (url?: string) => (url && /^https?:\/\//i.test(url) ? url : undefined);

interface Live { title: string; url?: string; gone?: boolean }

const Tile: React.FC<{ entry: Entry; live?: Live; thumb?: string }> = ({ entry, live, thumb }) => {
    const href = safeHref(live?.url);
    const title = live?.title || '(untitled)';
    const body = (
        <>
            <div className="ask-prev-thumb">
                {live?.url ? <BookmarkPreview url={live.url} title={title} thumbnailUrl={thumb} variant="tile" /> : <ImageOff size={20} aria-hidden="true" />}
            </div>
            <div className="ask-prev-text">
                <span className="ask-prev-title" title={title}>{title}</span>
                <span className={`ask-prev-label${entry.undone ? ' ask-prev-label--undone' : ''}`}>
                    {live?.gone && !entry.undone ? (entry.label === 'Sent to Trash' ? 'Sent to Trash' : 'No longer in your bookmarks') : entry.label}
                    {entry.detail ? `: ${entry.detail}` : ''}
                </span>
            </div>
            {href && <ExternalLink size={14} className="ask-prev-open" aria-hidden="true" />}
        </>
    );
    return href
        ? <a className="ask-prev" href={href} target="_blank" rel="noopener noreferrer" title={`Open ${title} in a new tab`}>{body}</a>
        : <div className="ask-prev">{body}</div>;
};

export const AskAIPreviews: React.FC<{ items: ChatItem[] }> = ({ items }) => {
    const { changed, found, titles } = useMemo(() => previewEntries(items), [items]);
    const [live, setLive] = useState<Map<string, Live>>(new Map());
    const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
    const ids = useMemo(() => [...changed, ...found].map(e => e.id), [changed, found]);
    // Re-read on every chat change (a later change or an Undo alters the same bookmarks).
    const key = `${ids.join(',')}|${items.length}|${items.filter(i => i.kind === 'changes' && i.undone).length}`;

    useEffect(() => {
        let cancelled = false;
        const made: string[] = [];
        void (async () => {
            const next = new Map<string, Live>();
            // One lookup per id: chrome.bookmarks.get fails the whole call when any id is gone.
            await Promise.all(ids.map(async id => {
                try {
                    const [n] = await chrome.bookmarks.get(id);
                    next.set(id, { title: n.title, url: n.url });
                } catch {
                    const t = titles.get(id);
                    next.set(id, { title: t?.title ?? '(removed)', url: t?.url, gone: true });
                }
            }));
            if (cancelled) return;
            setLive(next);
            const urls = [...new Set([...next.values()].map(v => v.url).filter((u): u is string => !!safeHref(u)))];
            const pics = new Map<string, string>();
            await Promise.all(urls.map(async u => {
                const rec = await thumbnailStorage.getThumbnail(u).catch(() => undefined);
                if (rec?.blob) { const o = URL.createObjectURL(rec.blob); made.push(o); pics.set(u, o); }
            }));
            if (cancelled) { made.forEach(o => URL.revokeObjectURL(o)); return; }
            setThumbs(pics);
        })();
        return () => { cancelled = true; made.forEach(o => URL.revokeObjectURL(o)); };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!changed.length && !found.length) {
        return (
            <div className="ask-prev-empty">
                <p>Bookmarks the AI changes or looks at in this chat show here, with their previews.</p>
            </div>
        );
    }
    const section = (title: string, list: Entry[]) => list.length > 0 && (
        <section className="ask-prev-section" aria-label={title}>
            <h3>{title} <span className="ask-prev-count">{list.length}</span></h3>
            <div className="ask-prev-grid">
                {list.map(e => { const l = live.get(e.id); return <Tile key={e.id} entry={e} live={l} thumb={l?.url ? thumbs.get(l.url) : undefined} />; })}
            </div>
        </section>
    );
    return (
        <div className="ask-prev-wrap">
            {section('Changed in this chat', changed)}
            {section('Looked at', found)}
        </div>
    );
};
