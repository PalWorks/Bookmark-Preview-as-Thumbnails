// SPDX-License-Identifier: AGPL-3.0-only
//
// MCP server over stdio (JSON-RPC 2.0, one message per line). Tools map one to
// one onto the bridge requests; errors return isError with the full error body,
// so an agent can read the code, the fix and when to retry.
import readline from 'node:readline';
import { UNTRUSTED_NOTE, bridgeError, type BridgeError } from '../../src/lib/bridge/protocol.ts';
import { BridgeFailure, Connection, chooseTarget } from './client.ts';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<Record<string, unknown>> }

const target = { type: 'object', properties: {
    browser: { type: 'string', description: 'Only if several browsers are connected (AMBIGUOUS_TARGET).' },
    profile: { type: 'string', description: 'Only if several browser profiles are connected.' },
} } as const;
const paging = {
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Items per page (default 100).' },
    cursor: { type: 'string', description: 'From the previous page; omit for the first page.' },
};

export function tools(connect: (args: Record<string, unknown>) => Promise<Connection>): Tool[] {
    const call = (type: Parameters<Connection['request']>[0], pick: (a: Record<string, unknown>) => Record<string, unknown>) =>
        async (args: Record<string, unknown>) => {
            const c = await connect(args);
            try { return await c.request(type, pick(args)); } finally { c.close(); }
        };
    return [
        {
            name: 'pair',
            description: 'Pair with the user\'s browser. Call with no code first: the extension shows a 6-digit code to the user. Then ask the user for the code and call pair again with it. Needed once per browser profile.',
            inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The 6-digit code the user reads in Settings > Coding agents.' }, ...target.properties } },
            run: async (args) => {
                const c = await connect(args);
                try {
                    const code = typeof args.code === 'string' && args.code.trim() ? args.code.trim() : undefined;
                    return await c.pair(code);
                } finally { c.close(); }
            },
        },
        {
            name: 'list_folders',
            description: `List the bookmark folders the user shared with this agent: id, path and item count. ${UNTRUSTED_NOTE}`,
            inputSchema: { type: 'object', properties: { ...paging, ...target.properties } },
            run: call('list_folders', a => ({ limit: a.limit, cursor: a.cursor })),
        },
        {
            name: 'list_folder',
            description: `List one shared folder: bookmarks (title, url, tags, rating, last opened, whether a preview exists) and subfolders. ${UNTRUSTED_NOTE}`,
            inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, ...paging, ...target.properties } },
            run: call('list_folder', a => ({ id: a.id, limit: a.limit, cursor: a.cursor })),
        },
        {
            name: 'search',
            description: `Search shared bookmarks by title, URL and tags (case-insensitive), best matches first. ${UNTRUSTED_NOTE}`,
            inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, ...paging, ...target.properties } },
            run: call('search', a => ({ query: a.query, limit: a.limit, cursor: a.cursor })),
        },
        {
            name: 'get_bookmark',
            description: `Details of one shared bookmark or folder. ${UNTRUSTED_NOTE}`,
            inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, ...target.properties } },
            run: call('get_bookmark', a => ({ id: a.id })),
        },
        {
            name: 'propose_changes',
            description: 'Propose changes to shared bookmarks. Nothing changes until the user reviews and applies them in the extension; they can undo with one click. changeSet = {"title": "...", "ops": [...]} with ops: {"op":"create_folder","tempId":"new:1","parentId":"<id or new:N>","title":"..."}, {"op":"move","id","parentId","index"?}, {"op":"rename","id","title"}, {"op":"set_tags","id","tags":[]}, {"op":"set_rating","id","rating":1-5|null}, {"op":"trash","id"}. At most 200 changes; an item sent to Trash gets no other change; create a folder before moving into it. Returns accepted:false with a reason per change when it cannot be applied. Pass an idempotencyKey so a retry never makes a second proposal.',
            inputSchema: { type: 'object', required: ['changeSet'], properties: { changeSet: { type: 'object' }, idempotencyKey: { type: 'string' }, ...target.properties } },
            run: call('propose_changes', a => ({ changeSet: a.changeSet, idempotencyKey: a.idempotencyKey })),
        },
        {
            name: 'get_change_set',
            description: 'Status of a proposal this agent sent: pending (the user has not decided), applied, partly_applied, rejected, expired, undone, with a state per change. Poll every 10 seconds at most.',
            inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, ...target.properties } },
            run: call('get_change_set', a => ({ id: a.id })),
        },
    ];
}

export async function runMcp(opts: { version: string; clientName?: string; beforeStart?: () => void }): Promise<void> {
    let clientName = opts.clientName ?? 'MCP client';
    const connect = async (args: Record<string, unknown>) => {
        const t = await chooseTarget({ browser: typeof args.browser === 'string' ? args.browser : undefined, profile: typeof args.profile === 'string' ? args.profile : undefined });
        const c = new Connection(t, clientName, opts.version);
        await c.open();
        return c;
    };
    const list = tools(connect);
    opts.beforeStart?.();

    const write = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n');
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
        void (async () => {
            let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
            try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
            const { id, method, params = {} } = msg;
            const reply = (result: unknown) => { if (id !== undefined) write({ jsonrpc: '2.0', id, result }); };
            const fail = (code: number, message: string) => { if (id !== undefined) write({ jsonrpc: '2.0', id, error: { code, message } }); };
            switch (method) {
                case 'initialize': {
                    const asked = String(params.protocolVersion ?? '');
                    const info = params.clientInfo as { name?: string } | undefined;
                    if (info?.name) clientName = String(info.name).slice(0, 64);
                    return reply({
                        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name: 'bookmarks-thumbnails', version: opts.version },
                        instructions: 'Read and organise the user\'s Chrome bookmarks in the folders they shared. Every change is only a proposal until the user applies it in the extension. Start with list_folders; if it says NOT_PAIRED, call pair.',
                    });
                }
                case 'notifications/initialized':
                case 'notifications/cancelled':
                    return;
                case 'ping':
                    return reply({});
                case 'tools/list':
                    return reply({ tools: list.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
                case 'tools/call': {
                    const tool = list.find(t => t.name === params.name);
                    if (!tool) return fail(-32602, `Unknown tool ${String(params.name)}`);
                    try {
                        const body = await tool.run((params.arguments as Record<string, unknown>) ?? {});
                        return reply({ content: [{ type: 'text', text: JSON.stringify(body, null, 1) }], structuredContent: body });
                    } catch (err) {
                        const e: BridgeError = err instanceof BridgeFailure ? err.error : bridgeError('INTERNAL', err instanceof Error ? err.message : String(err));
                        return reply({ content: [{ type: 'text', text: JSON.stringify({ error: e }, null, 1) }], structuredContent: { error: e }, isError: true });
                    }
                }
                default:
                    return fail(-32601, `Method not found: ${String(method)}`);
            }
        })();
    });
    await new Promise<void>(resolve => rl.on('close', () => resolve()));
}
