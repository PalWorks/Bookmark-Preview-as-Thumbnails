// SPDX-License-Identifier: AGPL-3.0-only
//
// Allowlist for metadata written by extension pages (META_PATCH) and by backup
// import. Only known fields with valid types get through; anything else in a
// message is dropped, so a page can never store arbitrary data under meta_<url>.

import type { MetadataRecord, ThumbnailStatus } from './storage_index';

const STATUSES: readonly ThumbnailStatus[] = ['none', 'pending', 'saved_indexeddb', 'saved_disk', 'error'];
const MAX_TITLE = 1000;

export const MAX_META_ID = 2048;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

/** A page-sent patch: `rating: null` clears the rating. */
export type PagePatch = {
    rating?: number | null;
    lastOpenedAt?: number;
    tags?: string[];
    title?: string;
    status?: ThumbnailStatus;
    lastCaptureAt?: number;
};

export function isValidMetaId(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_META_ID;
}

function cleanRating(v: unknown): number | null | undefined {
    if (v === null) return null;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5) return v;
    return undefined;
}

function cleanTime(v: unknown, now: number): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
    return Math.min(Math.round(v), now);
}

export function cleanTags(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const t of v) {
        if (typeof t !== 'string') continue;
        const s = t.trim().slice(0, MAX_TAG_LENGTH);
        if (s && !out.includes(s)) out.push(s);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

/**
 * Keep only the fields a page may change, with valid values. Returns the patch to
 * merge (rating null already turned into "remove") or undefined if nothing is left.
 */
export function sanitizePagePatch(raw: unknown, now = Date.now(), id?: string): { set: Partial<MetadataRecord>; clearRating: boolean } | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const set: Partial<MetadataRecord> = {};
    // Backup import restores these for its own previews; the URL must be the record's id.
    if (typeof r.url === 'string' && id !== undefined && r.url === id) set.url = r.url;
    if (typeof r.title === 'string') set.title = r.title.slice(0, MAX_TITLE);
    if (typeof r.status === 'string' && (STATUSES as readonly string[]).includes(r.status)) set.status = r.status as ThumbnailStatus;
    if ('lastCaptureAt' in r) {
        const t = cleanTime(r.lastCaptureAt, now);
        if (t !== undefined) set.lastCaptureAt = t;
    }
    let clearRating = false;
    if ('rating' in r) {
        const rating = cleanRating(r.rating);
        if (rating === null) clearRating = true;
        else if (rating !== undefined) set.rating = rating;
    }
    if ('lastOpenedAt' in r) {
        const t = cleanTime(r.lastOpenedAt, now);
        if (t !== undefined) set.lastOpenedAt = t;
    }
    if ('tags' in r) {
        const tags = cleanTags(r.tags);
        if (tags !== undefined) set.tags = tags;
    }
    if (Object.keys(set).length === 0 && !clearRating) return undefined;
    return { set, clearRating };
}

/** One backed-up metadata record: url plus the user's own fields. */
export interface BackupMeta {
    url: string;
    rating?: number;
    lastOpenedAt?: number;
    tags?: string[];
}

export function sanitizeBackupMeta(raw: unknown, now = Date.now()): BackupMeta | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    if (!isValidMetaId(r.url)) return undefined;
    const out: BackupMeta = { url: r.url };
    const rating = cleanRating(r.rating);
    if (typeof rating === 'number') out.rating = rating;
    const t = cleanTime(r.lastOpenedAt, now);
    if (t !== undefined) out.lastOpenedAt = t;
    const tags = cleanTags(r.tags);
    if (tags && tags.length) out.tags = tags;
    return out.rating || out.lastOpenedAt || out.tags ? out : undefined;
}
