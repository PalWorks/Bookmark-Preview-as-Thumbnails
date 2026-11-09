// SPDX-License-Identifier: AGPL-3.0-only
// Where the helper keeps its files, per OS. Linux and macOS (Stage 2); Windows is Stage 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOST_NAME } from '../../src/lib/bridge/protocol.ts';

export type Browser = 'chrome';
export const BROWSERS: Browser[] = ['chrome'];

const home = () => process.env.HOME || os.homedir();
const isMac = () => process.platform === 'darwin';

export function supportedPlatform(): boolean {
    return process.platform === 'linux' || process.platform === 'darwin';
}

/** Sockets live here (user-only, 0700). */
export function runtimeDir(): string {
    if (process.env.BOOKMARKS_THUMBNAILS_RUNTIME_DIR) return process.env.BOOKMARKS_THUMBNAILS_RUNTIME_DIR;
    if (isMac()) return path.join(process.env.TMPDIR || '/tmp', 'bookmarks-thumbnails');
    if (process.env.XDG_RUNTIME_DIR) return path.join(process.env.XDG_RUNTIME_DIR, 'bookmarks-thumbnails');
    return `/tmp/bookmarks-thumbnails-${process.getuid?.() ?? 'user'}`;
}

/** The installed host copy, its launcher and log. */
export function dataDir(): string {
    if (process.env.BOOKMARKS_THUMBNAILS_DATA_DIR) return process.env.BOOKMARKS_THUMBNAILS_DATA_DIR;
    return isMac()
        ? path.join(home(), 'Library', 'Application Support', 'bookmarks-thumbnails')
        : path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'bookmarks-thumbnails');
}

/** Pairing tokens (0600). */
export function tokenFile(): string {
    if (process.env.BOOKMARKS_THUMBNAILS_TOKEN_FILE) return process.env.BOOKMARKS_THUMBNAILS_TOKEN_FILE;
    const dir = isMac()
        ? path.join(home(), 'Library', 'Application Support', 'bookmarks-thumbnails')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(home(), '.config'), 'bookmarks-thumbnails');
    return path.join(dir, 'tokens.json');
}

/** Chrome's per-user NativeMessagingHosts folder. */
export function manifestDir(browser: Browser, override?: string): string {
    if (override) return override;
    void browser;
    return isMac()
        ? path.join(home(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(home(), '.config'), 'google-chrome', 'NativeMessagingHosts');
}

export const manifestPath = (browser: Browser, override?: string) => path.join(manifestDir(browser, override), `${HOST_NAME}.json`);
export const launcherPath = (browser: Browser) => path.join(dataDir(), `host-${browser}.sh`);
export const hostCopyPath = () => path.join(dataDir(), 'host.js');
export const versionFile = () => path.join(dataDir(), 'VERSION');
export const hostLog = () => path.join(dataDir(), 'host.log');
export const socketPath = (browser: string, profileId: string) => path.join(runtimeDir(), `${browser}-${profileId}.sock`);

/**
 * Client side: the same checks without creating anything. A folder another user
 * made (for example /tmp/bookmarks-thumbnails-<uid> when XDG_RUNTIME_DIR is unset in
 * an ssh session) is never trusted. Returns the problem, or null when it is safe.
 */
export function verifyRuntimeDir(dir: string): string | null {
    let st: fs.Stats;
    try { st = fs.lstatSync(dir); } catch { return null; } // missing: nothing to connect to
    if (st.isSymbolicLink() || !st.isDirectory()) return `${dir} is not a real folder`;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return `${dir} belongs to another user`;
    if ((st.mode & 0o077) !== 0) return `${dir} is open to other users`;
    return null;
}

/** The runtime folder must be a real folder, owned by this user, closed to others. */
export function checkRuntimeDir(dir: string): string | null {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return `${dir} is not a real folder`;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return `${dir} belongs to another user`;
    if ((st.mode & 0o077) !== 0) {
        try { fs.chmodSync(dir, 0o700); } catch { return `${dir} is open to other users and could not be closed`; }
        if ((fs.lstatSync(dir).mode & 0o077) !== 0) return `${dir} is open to other users`;
    }
    return null;
}

