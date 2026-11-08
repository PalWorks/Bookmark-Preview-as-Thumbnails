// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the shared utilities.
 */
import { describe, it, expect } from 'vitest';
import { getDomain, countBookmarksDeep, buildDeepCountMap, faviconUrl, truncateTitle, formatAgo, formatIn, plural } from '../src/lib/utils';

describe('getDomain', () => {
    it('extracts hostname from a standard URL', () => {
        expect(getDomain('https://example.com/path')).toBe('example.com');
    });

    it('strips www. prefix', () => {
        expect(getDomain('https://www.example.com')).toBe('example.com');
    });

    it('preserves subdomains other than www', () => {
        expect(getDomain('https://blog.example.com')).toBe('blog.example.com');
    });

    it('returns empty string for undefined', () => {
        expect(getDomain(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(getDomain('')).toBe('');
    });

    it('returns empty string for invalid URL', () => {
        expect(getDomain('not-a-url')).toBe('');
    });

    it('handles URL with port', () => {
        expect(getDomain('https://localhost:3000')).toBe('localhost');
    });

    it('handles chrome:// URLs', () => {
        expect(getDomain('chrome://extensions')).toBe('extensions');
    });
});

const tree = {
    id: 'root', children: [
        { id: 'a', url: 'https://a.example/' },
        { id: 'f1', children: [
            { id: 'b', url: 'https://b.example/' },
            { id: 'f2', children: [{ id: 'c', url: 'https://c.example/' }, { id: 'd', url: 'https://d.example/' }] },
            { id: 'empty', children: [] },
        ] },
    ],
};

describe('deep counts', () => {
    it('counts bookmarks in every subfolder', () => {
        expect(countBookmarksDeep(tree)).toBe(4);
        expect(countBookmarksDeep(tree.children[1])).toBe(3);
        expect(countBookmarksDeep({ id: 'x', children: [] })).toBe(0);
    });

    it('builds a count map for all folders in one pass', () => {
        const m = buildDeepCountMap([tree]);
        expect(Object.fromEntries(m)).toEqual({ root: 4, f1: 3, f2: 2, empty: 0 });
    });

    it('handles 10,000 nodes quickly', () => {
        const big = { id: 'big', children: Array.from({ length: 10000 }, (_, i) => ({ id: `n${i}`, url: `https://x${i}.example/` })) };
        const t0 = performance.now();
        expect(buildDeepCountMap([big]).get('big')).toBe(10000);
        expect(performance.now() - t0).toBeLessThan(50);
    });
});

describe('faviconUrl', () => {
    it("points at Chrome's local favicon cache", () => {
        const u = new URL(faviconUrl('https://news.example/a?b=1', 32));
        expect(u.href.startsWith('chrome-extension://testextensionid/_favicon/')).toBe(true);
        expect(u.searchParams.get('pageUrl')).toBe('https://news.example/a?b=1');
        expect(u.searchParams.get('size')).toBe('32');
    });
});

describe('labels', () => {
    it('truncates titles at 40 characters with an ellipsis', () => {
        expect(truncateTitle('Short')).toBe('Short');
        expect(truncateTitle('x'.repeat(41))).toBe(`${'x'.repeat(40)}…`);
        expect(truncateTitle('   ')).toBe('Untitled');
    });

    it('formats relative days and plurals', () => {
        const now = Date.UTC(2026, 10, 8);
        const day = 86400000;
        expect(formatAgo(now, now)).toBe('today');
        expect(formatAgo(now - day, now)).toBe('yesterday');
        expect(formatAgo(now - 2 * day, now)).toBe('2 days ago');
        expect(formatIn(now + 28 * day, now)).toBe('in 28 days');
        expect(formatIn(now + day, now)).toBe('tomorrow');
        expect(plural(1, 'bookmark')).toBe('1 bookmark');
        expect(plural(3, 'bookmark')).toBe('3 bookmarks');
    });
});
