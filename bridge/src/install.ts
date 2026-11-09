// SPDX-License-Identifier: AGPL-3.0-only
//
// install, uninstall and doctor. install copies the host out of the npx cache to
// a stable per-user folder, writes a launcher with the absolute Node path, and
// points Chrome's host manifest at the launcher. Idempotent: run it again any time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_NAME, STORE_EXTENSION_ID, PACKAGE_NAME } from '../../src/lib/bridge/protocol.ts';
import {
    BROWSERS, checkRuntimeDir, dataDir, hostCopyPath, hostLog, launcherPath, manifestPath, runtimeDir,
    supportedPlatform, versionFile, type Browser,
} from './paths.ts';
import { liveTargets, readTokens } from './client.ts';

export interface InstallOptions {
    dryRun?: boolean;
    nodePath?: string;
    manifestDir?: string;
    extensionIds?: string[];
    browsers?: Browser[];
    version: string;
    /** First run of the MCP server: install only when nothing is installed; never replace. */
    onlyIfMissing?: boolean;
}

export interface StepResult { browser: string; ok: boolean; line: string }

/** The bundled host that sits next to this file in the package. */
export function bundledHost(): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.js');
}

const ORIGIN = (id: string) => `chrome-extension://${id}/`;
/** Single-quote for sh: nothing inside is expanded. */
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const isExtId = (id: string) => /^[a-p]{32}$/.test(id);

export function install(o: InstallOptions): { ok: boolean; results: StepResult[]; paths: string[] } {
    if (!supportedPlatform()) {
        return { ok: false, paths: [], results: [{ browser: 'all', ok: false, line: `FAIL ${process.platform} is not supported yet (Linux and macOS for now).` }] };
    }
    const node = o.nodePath ?? process.execPath;
    const ids = [STORE_EXTENSION_ID, ...(o.extensionIds ?? []).filter(isExtId)];
    const results: StepResult[] = [];
    const paths: string[] = [];
    const browsers = o.browsers?.length ? o.browsers : BROWSERS;
    if (o.onlyIfMissing && browsers.every(b => fs.existsSync(manifestPath(b, o.manifestDir)))) {
        return { ok: true, paths: [], results: browsers.map(b => ({ browser: b, ok: true, line: `OK ${b}: already installed` })) };
    }
    const host = hostCopyPath();
    paths.push(host, versionFile());
    if (!o.dryRun) {
        fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
        fs.copyFileSync(bundledHost(), host);
        fs.chmodSync(host, 0o755);
        fs.writeFileSync(versionFile(), `${o.version}\n`);
    }
    for (const b of browsers) {
        try {
            const launcher = launcherPath(b);
            const manifest = manifestPath(b, o.manifestDir);
            paths.push(launcher, manifest);
            if (!o.dryRun) {
                fs.writeFileSync(launcher, `#!/bin/sh\n# ${PACKAGE_NAME} ${o.version}: Chrome starts this when the extension's switch is on.\nexec ${shq(node)} ${shq(host)} --browser ${b} "$@"\n`, { mode: 0o755 });
                fs.chmodSync(launcher, 0o755);
                fs.mkdirSync(path.dirname(manifest), { recursive: true });
                fs.writeFileSync(manifest, JSON.stringify({
                    name: HOST_NAME,
                    description: 'Visual Bookmark Manager with Thumbnail Previews: coding-agent helper',
                    path: launcher,
                    type: 'stdio',
                    allowed_origins: ids.map(ORIGIN),
                }, null, 2) + '\n');
            }
            results.push({ browser: b, ok: true, line: `OK ${b}: ${o.dryRun ? 'would write' : 'wrote'} ${manifest}` });
        } catch (err) {
            results.push({ browser: b, ok: false, line: `FAIL ${b}: ${err instanceof Error ? err.message : err}. Rerun install, it is safe.` });
        }
    }
    return { ok: results.every(r => r.ok), results, paths };
}

export function uninstall(o: { manifestDir?: string; dryRun?: boolean }): StepResult[] {
    const out: StepResult[] = [];
    const rm = (p: string, label: string) => {
        if (!fs.existsSync(p)) return;
        if (!o.dryRun) fs.rmSync(p, { force: true });
        out.push({ browser: label, ok: true, line: `${o.dryRun ? 'would remove' : 'removed'} ${p}` });
    };
    for (const b of BROWSERS) { rm(manifestPath(b, o.manifestDir), b); rm(launcherPath(b), b); }
    rm(hostCopyPath(), 'all');
    rm(versionFile(), 'all');
    try {
        for (const n of fs.readdirSync(runtimeDir())) if (n.endsWith('.sock')) rm(path.join(runtimeDir(), n), 'all');
    } catch { /* no runtime folder */ }
    if (!out.length) out.push({ browser: 'all', ok: true, line: 'Nothing to remove.' });
    return out;
}

export interface DoctorCheck { name: string; ok: boolean; detail: string; fix?: string }

export async function doctor(o: { manifestDir?: string; version: string }): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];
    const add = (name: string, ok: boolean, detail: string, fix?: string) => checks.push({ name, ok, detail, ...(ok || !fix ? {} : { fix }) });
    const major = Number(process.versions.node.split('.')[0]);
    add('node', major >= 22, `Node ${process.versions.node} (needs 22 or newer)`, 'Install Node 22 or newer, then rerun install.');
    add('platform', supportedPlatform(), process.platform, 'Linux and macOS are supported for now.');
    if (process.env.FLATPAK_ID || process.env.SNAP) add('sandbox', false, 'This looks like a Flatpak or Snap session.', 'Flatpak and Snap browsers are not supported; use Chrome from google.com.');
    for (const b of BROWSERS) {
        const mp = manifestPath(b, o.manifestDir);
        let manifest: { path?: string; allowed_origins?: string[] } | undefined;
        try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { /* missing */ }
        add(`${b}: host manifest`, !!manifest, manifest ? mp : `missing: ${mp}`, `Run: npx ${PACKAGE_NAME} install`);
        if (manifest) {
            add(`${b}: allowed extension ids`, (manifest.allowed_origins ?? []).includes(ORIGIN(STORE_EXTENSION_ID)), (manifest.allowed_origins ?? []).join(', ') || 'none', `Run: npx ${PACKAGE_NAME} install`);
            const launcher = manifest.path ?? '';
            const launcherOk = fs.existsSync(launcher);
            add(`${b}: launcher`, launcherOk, launcher || 'not set', `Run: npx ${PACKAGE_NAME} install`);
            if (launcherOk) {
                const nodeInLauncher = /exec '((?:[^']|'\\'')+)'/.exec(fs.readFileSync(launcher, 'utf8'))?.[1]?.replace(/'\\''/g, "'");
                add(`${b}: Node in launcher`, !!nodeInLauncher && fs.existsSync(nodeInLauncher), nodeInLauncher ?? 'not found', `Node moved. Run: npx ${PACKAGE_NAME} install`);
            }
        }
    }
    let installed = '';
    try { installed = fs.readFileSync(versionFile(), 'utf8').trim(); } catch { /* none */ }
    add('host version', installed === o.version, installed ? `installed ${installed}, this package ${o.version}` : 'no host installed', `Run: npx ${PACKAGE_NAME}@${o.version} install (a running browser picks it up at its next start)`);
    const rd = runtimeDir();
    const problem = (() => { try { return checkRuntimeDir(rd); } catch (err) { return String(err); } })();
    add('runtime folder', !problem, problem ?? rd, 'Remove the folder (or the link) and turn the switch off and on.');
    const live = await liveTargets();
    add('browser connected', live.length > 0, live.length ? live.map(t => `${t.browser}-${t.profileId}`).join(', ') : 'no browser profile has the switch on', 'In Chrome: extension > Settings > Coding agents > Connect coding agents.');
    const paired = Object.keys(readTokens().profiles);
    add('paired', paired.length > 0, paired.length ? paired.join(', ') : 'not paired', 'Ask your agent to "pair with my bookmarks", or run: bookmarks-thumbnails pair');
    return checks;
}

export function lastLogError(): string {
    try {
        const lines = fs.readFileSync(hostLog(), 'utf8').trim().split('\n');
        return [...lines].reverse().find(l => / error /.test(l)) ?? 'No errors logged.';
    } catch {
        return 'No host log yet.';
    }
}
