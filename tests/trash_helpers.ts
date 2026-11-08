// SPDX-License-Identifier: AGPL-3.0-only
// Shared helpers for the trash service tests.
import { vi } from 'vitest';
import { createTrashService } from '../src/sw/trash';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore } from './setup';
import type { TrashEntry, TrashProgress } from '../src/lib/trash_store';

export const clock = { t: 1_800_000_000_000 };

/** A service like a freshly started worker. State shared via storage and bookmarks only. */
export function makeService() {
    let n = 0;
    fakeBookmarks.useClock(() => clock.t);
    const broadcast = vi.fn();
    const service = createTrashService({
        now: () => clock.t,
        uuid: () => `id-${++n}-${Math.random().toString(36).slice(2, 8)}`,
        broadcast,
    });
    return { service, broadcast };
}

export function entries(): TrashEntry[] {
    return Object.entries(localStore)
        .filter(([k]) => k.startsWith('trash_v1_'))
        .map(([, v]) => v as TrashEntry);
}

export function progressOf(entryId: string): TrashProgress {
    return localStore[`trash_prog_${entryId}`] as TrashProgress;
}

/** Folder "Recipes" in the Bookmarks bar: 3 bookmarks and a subfolder with 1. */
export function seedRecipes() {
    const before = fakeBookmarks.seed('1', 'Before', 'https://before.example/');
    const folder = fakeBookmarks.seed('1', 'Recipes');
    const soup = fakeBookmarks.seed(folder.id, 'Soup', 'https://soup.example/');
    const cake = fakeBookmarks.seed(folder.id, 'Cake', 'https://cake.example/');
    const sub = fakeBookmarks.seed(folder.id, 'Drinks');
    const tea = fakeBookmarks.seed(sub.id, 'Tea', 'https://tea.example/');
    const pie = fakeBookmarks.seed(folder.id, 'Pie', 'https://pie.example/');
    const after = fakeBookmarks.seed('1', 'After', 'https://after.example/');
    return { before, folder, soup, cake, sub, tea, pie, after };
}

/** Structure without ids or dates, for comparing a restored subtree with the original. */
export function shape(node: chrome.bookmarks.BookmarkTreeNode): unknown {
    return node.url
        ? { title: node.title, url: node.url }
        : { title: node.title, children: (node.children ?? []).map(shape) };
}
