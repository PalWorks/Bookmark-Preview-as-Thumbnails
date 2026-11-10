// SPDX-License-Identifier: AGPL-3.0-only
// What Ask AI's preview pane lists, derived from the chat rows (src/components/AskAIPreviews.tsx).
import type { ChatItem } from '../../popup/hooks/useAskAI';

const MAX_SHOWN = 48;

export interface PreviewEntry { id: string; label: string; detail?: string; undone?: boolean }

/** Changed first (newest change set first), then found, each bookmark once. */
export function previewEntries(items: ChatItem[]): { changed: PreviewEntry[]; found: PreviewEntry[]; titles: Map<string, { title: string; url?: string }> } {
    const changed: PreviewEntry[] = [];
    const found: PreviewEntry[] = [];
    const seen = new Set<string>();
    const titles = new Map<string, { title: string; url?: string }>();
    for (const it of items) {
        if (it.kind === 'tool' && it.refs) for (const r of it.refs) titles.set(r.id, { title: r.title, url: r.url });
    }
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === 'pending' && !it.decided && it.targets) {
            for (const t of it.targets) {
                if (seen.has(t.id)) continue;
                seen.add(t.id);
                changed.push({ id: t.id, label: `Waiting for your OK: ${t.op}`, detail: t.detail });
            }
        }
        if (it.kind === 'changes' && it.targets) {
            for (const t of it.targets) {
                if (seen.has(t.id)) continue;
                seen.add(t.id);
                changed.push({ id: t.id, label: it.undone ? `${t.op} (undone)` : t.op, detail: t.detail, undone: it.undone });
            }
        }
    }
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === 'tool' && it.refs) {
            for (const r of it.refs) {
                if (seen.has(r.id)) continue;
                seen.add(r.id);
                found.push({ id: r.id, label: r.folder ? `In ${r.folder}` : 'Looked at' });
            }
        }
    }
    return { changed: changed.slice(0, MAX_SHOWN), found: found.slice(0, MAX_SHOWN), titles };
}


interface TitledNode { id: string; title: string; url?: string; children?: TitledNode[] }

/** "Bookmarks bar > eComm Tools" for a folder id, or null when it is not in the tree. */
export function folderTitlePath(roots: TitledNode[], id: string): string | null {
    const walk = (nodes: TitledNode[], trail: string[]): string[] | null => {
        for (const n of nodes) {
            if (n.url) continue;
            const here = n.title ? [...trail, n.title] : trail;
            if (n.id === id) return here;
            const hit = n.children ? walk(n.children, here) : null;
            if (hit) return hit;
        }
        return null;
    };
    const found = walk(roots, []);
    return found && found.length ? found.join(' > ') : null;
}
