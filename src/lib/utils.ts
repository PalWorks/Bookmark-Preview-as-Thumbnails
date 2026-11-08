// SPDX-License-Identifier: AGPL-3.0-only
// Small pure helpers shared by the popup and the service worker. Keep this file
// free of DOM and React so the service worker bundle can import it.

/**
 * Extracts the domain from a URL, stripping the www. prefix if present.
 */
export function getDomain(url?: string): string {
    if (!url) return '';
    try {
        const h = new URL(url).hostname;
        return h.startsWith('www.') ? h.slice(4) : h;
    } catch { return ''; }
}

interface CountableNode {
    id: string;
    url?: string;
    children?: CountableNode[];
}

/** Number of bookmarks (not folders) in a subtree, including every subfolder. */
export function countBookmarksDeep(node: CountableNode): number {
    if (node.url) return 1;
    let n = 0;
    for (const child of node.children ?? []) n += countBookmarksDeep(child);
    return n;
}

/**
 * Deep bookmark counts for every folder in a forest, in one pass. Folders that
 * were fetched without children (for example search results) are absent.
 */
export function buildDeepCountMap(nodes: CountableNode[]): Map<string, number> {
    const map = new Map<string, number>();
    const visit = (node: CountableNode): number => {
        if (node.url) return 1;
        if (!node.children) return 0;
        let n = 0;
        for (const child of node.children) n += visit(child);
        map.set(node.id, n);
        return n;
    };
    nodes.forEach(visit);
    return map;
}

/**
 * URL of Chrome's local favicon cache for a page (needs the "favicon" permission).
 * Chrome answers every request, returning a generic globe for unknown sites.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.toString();
}

/** Truncate a title for UI messages: at most `max` characters plus an ellipsis. */
export function truncateTitle(title: string, max = 40): string {
    const t = (title || '').trim() || 'Untitled';
    return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

const DAY = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago". */
export function formatAgo(ms: number, now = Date.now()): string {
    const days = Math.floor((now - ms) / DAY);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}

/** "today", "tomorrow", "in 28 days". */
export function formatIn(ms: number, now = Date.now()): string {
    const days = Math.ceil((ms - now) / DAY);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    return `in ${days} days`;
}

/** "1 bookmark", "14 bookmarks". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
    return `${n} ${n === 1 ? word : pluralWord}`;
}
