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
