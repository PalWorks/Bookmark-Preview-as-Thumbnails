// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { sanitizePagePatch, sanitizeBackupMeta, isValidMetaId } from '../src/lib/metadata_sanitize';
import { patchMetadata } from '../src/lib/metadata_client';
import { localStore } from './setup';

const NOW = 1_800_000_000_000;

describe('metadata allowlist', () => {
    it('keeps rating 1 to 5, null clears, anything else is dropped', () => {
        expect(sanitizePagePatch({ rating: 4 }, NOW)).toEqual({ set: { rating: 4 }, clearRating: false });
        expect(sanitizePagePatch({ rating: null }, NOW)).toEqual({ set: {}, clearRating: true });
        expect(sanitizePagePatch({ rating: 6 }, NOW)).toBeUndefined();
        expect(sanitizePagePatch({ rating: 2.5 }, NOW)).toBeUndefined();
        expect(sanitizePagePatch({ rating: '5' }, NOW)).toBeUndefined();
    });

    it('clamps lastOpenedAt to now and drops unknown fields', () => {
        expect(sanitizePagePatch({ lastOpenedAt: NOW + 99999, evil: '<script>' }, NOW)).toEqual({ set: { lastOpenedAt: NOW }, clearRating: false });
        expect(sanitizePagePatch({ lastOpenedAt: -1 }, NOW)).toBeUndefined();
    });

    it('accepts url only when it equals the record id, and valid statuses', () => {
        expect(sanitizePagePatch({ url: 'https://a.example/', status: 'saved_disk' }, NOW, 'https://a.example/'))
            .toEqual({ set: { url: 'https://a.example/', status: 'saved_disk' }, clearRating: false });
        expect(sanitizePagePatch({ url: 'https://evil.example/' }, NOW, 'https://a.example/')).toBeUndefined();
        expect(sanitizePagePatch({ status: 'hacked' }, NOW)).toBeUndefined();
    });

    it('tags: strings only, trimmed, capped', () => {
        const tags = Array.from({ length: 30 }, (_, i) => ` t${i} `);
        const r = sanitizePagePatch({ tags: [...tags, 5, null] }, NOW)!;
        expect(r.set.tags).toHaveLength(20);
        expect(r.set.tags![0]).toBe('t0');
    });

    it('ids are bounded', () => {
        expect(isValidMetaId('x'.repeat(2048))).toBe(true);
        expect(isValidMetaId('x'.repeat(2049))).toBe(false);
        expect(isValidMetaId('')).toBe(false);
    });

    it('backup records keep only user fields', () => {
        expect(sanitizeBackupMeta({ url: 'https://a.example/', rating: 3, status: 'error', tags: ['x'] }, NOW))
            .toEqual({ url: 'https://a.example/', rating: 3, tags: ['x'] });
        expect(sanitizeBackupMeta({ url: 'https://a.example/', rating: 9 }, NOW)).toBeUndefined();
        expect(sanitizeBackupMeta({ rating: 3 }, NOW)).toBeUndefined();
    });

    it('the local fallback applies the same rules and can clear a rating', async () => {
        await patchMetadata('https://a.example/', { rating: 5 });
        expect((localStore['meta_https://a.example/'] as { rating?: number }).rating).toBe(5);
        await patchMetadata('https://a.example/', { rating: null });
        expect((localStore['meta_https://a.example/'] as { rating?: number }).rating).toBeUndefined();
    });
});
