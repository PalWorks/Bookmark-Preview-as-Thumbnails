// SPDX-License-Identifier: AGPL-3.0-only
//
// MCP server over stdio (JSON-RPC 2.0, one message per line). Tools map one to
// one onto the bridge requests; errors return isError with the full error body,
// so an agent can read the code, the fix and when to retry.
import readline from 'node:readline';
import { bridgeError, type BridgeError } from '../../src/lib/bridge/protocol.ts';
import { TOOL_DEFS, AGENT_INSTRUCTIONS, pickArgs } from '../../src/lib/bridge/tools.ts';
import { BridgeFailure, Connection, chooseTarget } from './client.ts';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<Record<string, unknown>> }

const target = { type: 'object', properties: {
    browser: { type: 'string', description: 'Only if several browsers are connected (AMBIGUOUS_TARGET).' },
    profile: { type: 'string', description: 'Only if several browser profiles are connected.' },
} } as const;

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
            inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The 6-digit code the extension shows the user.' }, ...target.properties } },
            run: async (args) => {
                const c = await connect(args);
                try {
                    const code = typeof args.code === 'string' && args.code.trim() ? args.code.trim() : undefined;
                    return await c.pair(code);
                } finally { c.close(); }
            },
        },
        // Every other tool is the shared list (src/lib/bridge/tools.ts), plus the browser and profile choice.
        ...TOOL_DEFS.map(def => ({
            name: def.name,
            description: def.description,
            inputSchema: { ...def.inputSchema, properties: { ...(def.inputSchema.properties as Record<string, unknown>), ...target.properties } },
            annotations: { readOnlyHint: def.readOnly },
            run: call(def.request, a => pickArgs(def, a)),
        })),
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
                        instructions: `${AGENT_INSTRUCTIONS} If a tool says NOT_PAIRED, call pair.`,
                    });
                }
                case 'notifications/initialized':
                case 'notifications/cancelled':
                    return;
                case 'ping':
                    return reply({});
                case 'tools/list':
                    return reply({ tools: list.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
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
