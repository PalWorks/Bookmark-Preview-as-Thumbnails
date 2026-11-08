// SPDX-License-Identifier: AGPL-3.0-only
//
// List view columns: ids, defaults, and how each value is derived and formatted.
// DOM-free so the settings allowlist (backup_manager) can import it.

export const LIST_COLUMNS = ['added', 'opened', 'rating', 'visits', 'lastVisited'] as const;
export type ListColumn = typeof LIST_COLUMNS[number];

/** Columns that need the optional `history` permission. */
export const HISTORY_COLUMNS: readonly ListColumn[] = ['visits', 'lastVisited'];
export const DEFAULT_LIST_COLUMNS: ListColumn[] = ['added', 'opened', 'rating'];

export const LIST_COLUMN_LABELS: Record<ListColumn, string> = {
    added: 'Added',
    opened: 'Opened',
    rating: 'Rating',
    visits: 'Visits',
    lastVisited: 'Last visited',
};

export function isListColumn(v: unknown): v is ListColumn {
    return typeof v === 'string' && (LIST_COLUMNS as readonly string[]).includes(v);
}

/** A stored or imported column list, cleaned (order kept, duplicates dropped). */
export function sanitizeListColumns(v: unknown): ListColumn[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out: ListColumn[] = [];
    for (const c of v) if (isListColumn(c) && !out.includes(c)) out.push(c);
    return out;
}

/**
 * "Opened": the later of Chrome's own record (`dateLastUsed`, set when a bookmark is
 * opened from Chrome's bookmark UI) and this extension's record (`lastOpenedAt`).
 * Browsing history is a separate column (Last visited) and never mixed in.
 */
export function openedAt(dateLastUsed: number | undefined, lastOpenedAt: number | undefined): number | undefined {
    const a = typeof dateLastUsed === 'number' && dateLastUsed > 0 ? dateLastUsed : undefined;
    const b = typeof lastOpenedAt === 'number' && lastOpenedAt > 0 ? lastOpenedAt : undefined;
    if (a === undefined) return b;
    if (b === undefined) return a;
    return Math.max(a, b);
}

const DAY = 24 * 60 * 60 * 1000;

/** Short date: "3 Mar 2024". */
export function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Relative for the last 30 days ("today", "yesterday", "5 days ago"), else a date. */
export function formatRelative(ms: number, now = Date.now()): string {
    const days = Math.floor((now - ms) / DAY);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return formatDate(ms);
}

/** Missing values always sort last, whatever the direction. */
export function compareOptional(a: number | undefined, b: number | undefined, desc: boolean): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return desc ? b - a : a - b;
}
