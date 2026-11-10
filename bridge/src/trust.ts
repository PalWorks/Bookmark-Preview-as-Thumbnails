// SPDX-License-Identifier: AGPL-3.0-only
//
// Which unpacked copies of the extension the user has allowed to start the helper
// (review F7). Only the Web Store copy is trusted without asking: Google signs it and
// its id cannot be claimed by anyone else. An unpacked copy is just a folder whose
// manifest carries our name, so install shows it and asks once; the answer is kept
// here, in the helper's own folder, readable by this user only.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.ts';

export interface TrustedCopy {
    id: string;
    /** The folder the user confirmed; empty when the id was given with --extension-id. */
    path: string;
    at: string;
}

export const trustFile = () => path.join(dataDir(), 'trusted-extensions.json');

export function readTrusted(): TrustedCopy[] {
    try {
        const list = JSON.parse(fs.readFileSync(trustFile(), 'utf8'))?.copies;
        return Array.isArray(list)
            ? list.filter((c: TrustedCopy) => /^[a-p]{32}$/.test(c?.id) && typeof c.path === 'string' && typeof c.at === 'string')
            : [];
    } catch {
        return [];
    }
}

/**
 * Trusted when the user confirmed this id for this folder, or gave the id by hand.
 * A copy that moved to another folder is asked about again.
 */
export function isTrusted(list: TrustedCopy[], id: string, folder: string): boolean {
    return list.some(c => c.id === id && (c.path === '' || path.resolve(c.path) === path.resolve(folder)));
}

export function addTrusted(copies: Array<{ id: string; path: string }>, now = new Date()): void {
    if (!copies.length) return;
    const list = readTrusted().filter(c => !copies.some(n => n.id === c.id && n.path === c.path));
    for (const c of copies) list.push({ id: c.id, path: c.path, at: now.toISOString() });
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(trustFile(), JSON.stringify({ copies: list }, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(trustFile(), 0o600);
}
