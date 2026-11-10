// SPDX-License-Identifier: AGPL-3.0-only
//
// Finds the Chrome data folders that hold the extension, so install needs no flags:
// the default folder, plus the folder of every Chrome this user is running with
// --user-data-dir (test profiles, automation). In each, it reads the profiles'
// Preferences for the Web Store copy and for unpacked copies (matched by name).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STORE_EXTENSION_ID } from '../../src/lib/bridge/protocol.ts';
import { manifestDir } from './paths.ts';

export const EXTENSION_NAME = 'Visual Bookmark Manager with Thumbnail Previews';

export interface ChromeFolder {
    /** Chrome's data folder (holds Default, Profile 1, ...). */
    dataDir: string;
    /** Where this Chrome looks for the helper manifest. */
    manifestDir: string;
    isDefault: boolean;
    hasStoreCopy: boolean;
    unpackedIds: string[];
}

const isExtId = (id: string) => /^[a-p]{32}$/.test(id);

/**
 * The --user-data-dir of one Chrome command line, or null. Chrome rewrites its own
 * /proc cmdline into one space-separated string, so this matches on text and
 * accepts NUL separators too.
 */
export function dataDirFromCommandLine(cmdline: string): string | null {
    const args = cmdline.split('\0').filter(Boolean);
    if (args.length > 1) {
        if (!/chrom/i.test(path.basename(args[0]))) return null;
        const dir = args.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
        return dir && path.isAbsolute(dir) ? path.resolve(dir) : null;
    }
    const line = cmdline.replace(/\0/g, ' ').trim();
    if (!/chrom/i.test(path.basename(line.split(' --')[0].split(' ')[0] ?? ''))) return null;
    const m = /--user-data-dir=(.+?)(?= --|$)/.exec(line);
    const dir = m?.[1].trim();
    return dir && path.isAbsolute(dir) ? path.resolve(dir) : null;
}

/** --user-data-dir of every Chrome this user runs. BOOKMARKS_THUMBNAILS_CHROME_DIRS replaces the scan (tests). */
export function runningDataDirs(): string[] {
    const override = process.env.BOOKMARKS_THUMBNAILS_CHROME_DIRS;
    if (override !== undefined) return override.split(path.delimiter).filter(d => path.isAbsolute(d));
    const found = new Set<string>();
    const take = (line: string) => { const d = dataDirFromCommandLine(line); if (d) found.add(d); };
    try {
        if (process.platform === 'linux') {
            const uid = process.getuid?.();
            for (const pid of fs.readdirSync('/proc')) {
                if (!/^\d+$/.test(pid)) continue;
                try {
                    if (uid !== undefined && fs.statSync(`/proc/${pid}`).uid !== uid) continue;
                    take(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
                } catch { /* process ended */ }
            }
        } else if (process.platform === 'darwin') {
            const out = execFileSync('ps', ['-xo', 'args='], { encoding: 'utf8', timeout: 5000 });
            for (const line of out.split('\n')) take(line);
        }
    } catch { /* no process list: the default folder still works */ }
    return [...found];
}

/** Reads one data folder's profiles. */
export function scanDataDir(dataDir: string, isDefault: boolean): ChromeFolder {
    const folder: ChromeFolder = { dataDir, manifestDir: path.join(dataDir, 'NativeMessagingHosts'), isDefault, hasStoreCopy: false, unpackedIds: [] };
    let entries: string[] = [];
    try { entries = fs.readdirSync(dataDir); } catch { return folder; }
    const ids = new Set<string>();
    for (const profile of entries) {
        for (const file of ['Preferences', 'Secure Preferences']) {
            let settings: Record<string, { path?: string }> | undefined;
            try { settings = JSON.parse(fs.readFileSync(path.join(dataDir, profile, file), 'utf8'))?.extensions?.settings; } catch { continue; }
            for (const [id, s] of Object.entries(settings ?? {})) {
                if (id === STORE_EXTENSION_ID) { folder.hasStoreCopy = true; continue; }
                if (!isExtId(id) || typeof s?.path !== 'string' || !path.isAbsolute(s.path)) continue;
                try {
                    if (JSON.parse(fs.readFileSync(path.join(s.path, 'manifest.json'), 'utf8')).name === EXTENSION_NAME) ids.add(id);
                } catch { /* folder moved or deleted */ }
            }
        }
    }
    folder.unpackedIds = [...ids].sort();
    return folder;
}

/** The default folder always; other running folders only when they hold the extension. */
export function findChromeFolders(): ChromeFolder[] {
    const defaultManifests = manifestDir('chrome');
    const defaultData = path.dirname(defaultManifests);
    const first = { ...scanDataDir(defaultData, true), manifestDir: defaultManifests };
    const others = runningDataDirs()
        .filter(d => path.resolve(d) !== path.resolve(defaultData))
        .map(d => scanDataDir(d, false))
        .filter(f => f.hasStoreCopy || f.unpackedIds.length > 0);
    return [first, ...others];
}
