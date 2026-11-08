// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { openedAt, compareOptional, sanitizeListColumns, formatRelative } from '../src/lib/list_columns';

describe('list columns', () => {
    it('Opened is the later of Chrome\'s record and this extension\'s', () => {
        expect(openedAt(undefined, undefined)).toBeUndefined();
        expect(openedAt(100, undefined)).toBe(100);
        expect(openedAt(undefined, 200)).toBe(200);
        expect(openedAt(300, 200)).toBe(300);
        expect(openedAt(0, 0)).toBeUndefined();
    });

    it('missing values sort last in both directions', () => {
        const vals = [3, undefined, 1, undefined, 2];
        expect([...vals].sort((a, b) => compareOptional(a, b, true))).toEqual([3, 2, 1, undefined, undefined]);
        expect([...vals].sort((a, b) => compareOptional(a, b, false))).toEqual([1, 2, 3, undefined, undefined]);
    });

    it('cleans stored column lists', () => {
        expect(sanitizeListColumns(['rating', 'nope', 'rating', 'added'])).toEqual(['rating', 'added']);
        expect(sanitizeListColumns('added')).toBeUndefined();
    });

    it('relative dates', () => {
        const now = 1_800_000_000_000;
        expect(formatRelative(now - 1000, now)).toBe('today');
        expect(formatRelative(now - 86_400_000, now)).toBe('yesterday');
        expect(formatRelative(now - 5 * 86_400_000, now)).toBe('5 days ago');
    });
});
