// SPDX-License-Identifier: AGPL-3.0-only
//
// bookmarks-thumbnails-mcp / bookmarks-thumbnails. With no command and no
// terminal on stdin it is the MCP server; otherwise a CLI whose command names
// match the MCP tools. Errors go to stderr with a fixed exit status per code.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { EXIT_CODES, PACKAGE_NAME, SETUP_COMMAND, bridgeError, type BridgeError } from '../../src/lib/bridge/protocol.ts';
import { BridgeFailure, Connection, chooseTarget } from './client.ts';
import { doctor, install, lastLogError, uninstall, untrustedCopies } from './install.ts';
import { findChromeFolders, type UnpackedCopy } from './detect.ts';
import { runMcp } from './mcp.ts';
import { manifestPath } from './paths.ts';

declare const __PACKAGE_VERSION__: string;
const VERSION = typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.0.0-dev';

const HELP = `${PACKAGE_NAME} ${VERSION}: let coding agents read the bookmark folders you share in Chrome
and change them, with one-click Undo (Visual Bookmark Manager with Thumbnail Previews).

Quick start (Claude Code):  ${SETUP_COMMAND}
Then ask the agent: "pair with my bookmarks".

Commands:
  install [--dry-run] [--node <path>] [--manifest-dir <dir>] [--extension-id <id>[,<id>]]
                  (finds Chrome data folders by itself; asks before allowing an unpacked copy)
  uninstall [--dry-run]
  doctor [--json] [--last-error]
  pair [--code <6 digits>]
  list-folders | list-folder <id> | search <query> | get-bookmark <id> | get-change-set <id>
  apply <file.json> [--key <idempotency key>]     change now (Undo stays available)
  undo <change set id>
  propose <file.json> [--key <idempotency key>]   send for review instead
Options: --browser <name> --profile <id> --limit <n> --cursor <c> --json
Docs: https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/blob/main/bridge/README.md`;

interface Args { _: string[]; flags: Record<string, string | boolean> }

function parse(argv: string[]): Args {
    const out: Args = { _: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const [k, v] = a.slice(2).split('=', 2);
            const next = argv[i + 1];
            if (v !== undefined) out.flags[k] = v;
            else if (next !== undefined && !next.startsWith('--') && !['dry-run', 'json', 'last-error', 'help', 'version'].includes(k)) { out.flags[k] = next; i++; }
            else out.flags[k] = true;
        } else out._.push(a);
    }
    return out;
}

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);

function fail(e: BridgeError, json: boolean): never {
    if (json) process.stderr.write(JSON.stringify({ error: e }) + '\n');
    else process.stderr.write(`${e.code}: ${e.message}\nFix: ${e.fix}\n${e.docUrl}\n`);
    process.exit(EXIT_CODES[e.code] ?? 1);
}

async function main(): Promise<void> {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) {
        process.stderr.write(`Node ${process.versions.node} found; ${PACKAGE_NAME} needs Node 22 or newer.\n`);
        process.exit(2);
    }
    const args = parse(process.argv.slice(2));
    const json = args.flags.json === true || (!process.stdout.isTTY && args.flags.json !== 'false');
    const cmd = args._[0];
    const print = (body: unknown, text?: string) => process.stdout.write(json || text === undefined ? JSON.stringify(body, null, 1) + '\n' : text + '\n');

    if (args.flags.version) { print({ version: VERSION }, VERSION); return; }
    if (args.flags.help || cmd === 'help') { process.stdout.write(HELP + '\n'); return; }

    if (!cmd) {
        if (process.stdin.isTTY) { process.stdout.write(HELP + '\n'); return; }
        // MCP server. First run installs the host if none is installed; it never replaces one.
        await runMcp({
            version: VERSION,
            beforeStart: () => {
                try {
                    if (!fs.existsSync(manifestPath('chrome'))) install({ version: VERSION, onlyIfMissing: true });
                } catch { /* doctor reports it */ }
            },
        });
        return;
    }

    switch (cmd) {
        case 'install': {
            const manifestDir = str(args.flags['manifest-dir']);
            const folders = manifestDir ? [] : findChromeFolders();
            const confirmed: UnpackedCopy[] = [];
            const pending = untrustedCopies(folders);
            // Review F7: an unpacked copy is only a folder that carries our name, so the
            // user confirms each one once. Without a terminal nothing is asked or allowed.
            if (pending.length && process.stdin.isTTY && !json) {
                const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
                process.stderr.write('Unpacked copies of the extension were found. Allow only copies you loaded yourself;\nan allowed copy can start this helper and talk to your coding agents.\n');
                for (const c of pending) {
                    const a = (await rl.question(`\n  id      ${c.id}\n  folder  ${c.path}\n  Chrome  ${c.dataDir}\nAllow this copy? [y/N] `)).trim().toLowerCase();
                    if (a === 'y' || a === 'yes') confirmed.push({ id: c.id, path: c.path });
                }
                rl.close();
            }
            const r = install({
                version: VERSION, dryRun: args.flags['dry-run'] === true, nodePath: str(args.flags.node), manifestDir, folders, confirmed,
                extensionIds: (str(args.flags['extension-id']) ?? '').split(',').map(s => s.trim()).filter(Boolean),
            });
            const next = [
                '', 'Next:',
                '  1. In Chrome, open the extension: menu > AI Tools > Connect Claude or ChatGPT > Coding agents > turn on "Connect coding agents".',
                `  2. Claude Code:  ${SETUP_COMMAND}`,
                `     Cursor / VS Code (mcp.json): {"mcpServers":{"bookmarks":{"command":"npx","args":["-y","${PACKAGE_NAME}@${VERSION}"]}}}`,
                '  3. Ask the agent: "pair with my bookmarks", and type the code the extension shows.',
            ];
            print(r, [...r.results.map(x => x.line), ...(args.flags['dry-run'] ? ['Paths:', ...r.paths.map(p => `  ${p}`)] : []), ...(r.ok ? next : ['Rerun install, it is safe.'])].join('\n'));
            return process.exit(r.ok ? 0 : 1);
        }
        case 'uninstall': {
            const r = uninstall({ manifestDir: str(args.flags['manifest-dir']), dryRun: args.flags['dry-run'] === true });
            print(r, r.map(x => x.line).join('\n'));
            return;
        }
        case 'doctor': {
            if (args.flags['last-error']) { print({ lastError: lastLogError() }, lastLogError()); return; }
            const checks = await doctor({ manifestDir: str(args.flags['manifest-dir']), version: VERSION });
            print({ ok: checks.every(c => c.ok), checks }, checks.map(c => `${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${c.detail}${c.fix ? `\n     Fix: ${c.fix}` : ''}`).join('\n'));
            return process.exit(checks.every(c => c.ok) ? 0 : 1);
        }
    }

    let conn: Connection | undefined;
    try {
        const t = await chooseTarget({ browser: str(args.flags.browser), profile: str(args.flags.profile) });
        conn = new Connection(t, 'bookmarks-thumbnails CLI', VERSION);
        await conn.open();
        const paging = { ...(str(args.flags.limit) ? { limit: Number(args.flags.limit) } : {}), ...(str(args.flags.cursor) ? { cursor: str(args.flags.cursor) } : {}) };
        const need = (i: number, what: string) => {
            if (!args._[i]) fail(bridgeError('INVALID_REQUEST', `Missing ${what}.`, { fix: `Usage: ${cmd} <${what}>` }), json);
            return args._[i];
        };
        let body: Record<string, unknown>;
        switch (cmd) {
            case 'pair': {
                let code = str(args.flags.code);
                if (!code) {
                    try { await conn.pair(); } catch (err) {
                        if (!(err instanceof BridgeFailure) || err.error.code !== 'PAIRING_PENDING') throw err;
                    }
                    if (!process.stdin.isTTY) fail(bridgeError('PAIRING_PENDING', 'The browser now shows a code.', { fix: `Rerun with --code <the 6 digits the extension shows>: ${PACKAGE_NAME} pair --code 123456` }), json);
                    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
                    code = (await rl.question('Type the code shown in your browser: ')).trim();
                    rl.close();
                }
                body = await conn.pair(code);
                break;
            }
            case 'list-folders': body = await conn.request('list_folders', paging); break;
            case 'list-folder': body = await conn.request('list_folder', { id: need(1, 'folder id'), ...paging }); break;
            case 'search': body = await conn.request('search', { query: args._.slice(1).join(' ') || need(1, 'query'), ...paging }); break;
            case 'get-bookmark': body = await conn.request('get_bookmark', { id: need(1, 'id') }); break;
            case 'get-change-set': body = await conn.request('get_change_set', { id: need(1, 'id') }); break;
            case 'apply':
            case 'propose': {
                const file = need(1, 'file.json');
                const changeSet = JSON.parse(fs.readFileSync(file, 'utf8'));
                body = await conn.request(cmd === 'apply' ? 'apply_changes' : 'propose_changes', { changeSet, ...(str(args.flags.key) ? { idempotencyKey: str(args.flags.key) } : {}) });
                break;
            }
            case 'undo': body = await conn.request('undo_changes', { id: need(1, 'change set id') }); break;
            default:
                fail(bridgeError('INVALID_REQUEST', `Unknown command "${cmd}".`, { fix: `Run ${PACKAGE_NAME} --help` }), json);
        }
        print(body);
    } catch (err) {
        fail(err instanceof BridgeFailure ? err.error : bridgeError('INTERNAL', err instanceof Error ? err.message : String(err)), json);
    } finally {
        conn?.close();
    }
}

void main();
