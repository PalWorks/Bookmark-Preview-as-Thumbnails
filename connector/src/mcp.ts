// SPDX-License-Identifier: AGPL-3.0-only
//
// MCP over Streamable HTTP with JSON responses (no SSE). Same JSON-RPC handling
// as the stdio server (bridge/src/mcp.ts); the tool list is TOOL_DEFS exactly,
// and each tool call becomes one bridge request relayed to the user's browser.
// Pure: the relay is passed in, so tests run without the Workers runtime.

import { AGENT_INSTRUCTIONS, TOOL_DEFS, findTool, pickArgs } from '../../src/lib/bridge/tools.ts';
import { PROTOCOL_VERSION, bridgeError, type BridgeError, type ClientRequest, type ClientResponse } from '../../src/lib/bridge/protocol.ts';

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_VERSION = '1.0.0';
/** Relayed tool calls name the app this way; the token, not the name, says which connection it is. */
export const TOOL_VIA = 'AI app';

/** Sends one bridge request to the browser and returns its answer (never throws). */
export type Relay = (req: ClientRequest, via: string) => Promise<ClientResponse>;

export interface McpOutcome {
    status: number;
    /** JSON body, or undefined for 202 with no body. */
    body?: unknown;
    /** The extension does not know this token: answer 401 so the app authorises again. */
    unauthorized?: boolean;
}

interface RpcMessage {
    jsonrpc?: unknown;
    id?: string | number | null;
    method?: unknown;
    params?: Record<string, unknown>;
}

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export const toolList = () =>
    TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema, annotations: { readOnlyHint: d.readOnly } }));

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** One JSON-RPC message. Returns the reply, null for notifications, or 'unauthorized'. */
async function dispatch(msg: RpcMessage, token: string, relay: Relay): Promise<unknown | null | 'unauthorized'> {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    const isNotification = id === undefined || id === null;
    const reply = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => (isNotification ? null : rpcError(id, code, message));

    switch (method) {
        case 'initialize': {
            const asked = String(params.protocolVersion ?? '');
            return reply({
                protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'bookmarks-thumbnails', version: SERVER_VERSION },
                instructions: AGENT_INSTRUCTIONS,
            });
        }
        case 'ping':
            return reply({});
        case 'tools/list':
            return reply({ tools: toolList() });
        case 'tools/call': {
            const def = findTool(params.name);
            if (!def) return fail(-32602, `Unknown tool ${String(params.name)}`);
            const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
            const req: ClientRequest = { v: PROTOCOL_VERSION, id: nextId(), type: def.request, token, body: pickArgs(def, args) };
            const res = await relay(req, TOOL_VIA);
            if (res.ok) return reply({ content: [{ type: 'text', text: JSON.stringify(res.body, null, 1) }], structuredContent: res.body });
            if (res.error.code === 'NOT_PAIRED') return 'unauthorized';
            const e: BridgeError = res.error ?? bridgeError('INTERNAL', 'No answer from the browser.');
            return reply({ content: [{ type: 'text', text: JSON.stringify({ error: e }, null, 1) }], structuredContent: { error: e }, isError: true });
        }
        default:
            if (method.startsWith('notifications/')) return null;
            return fail(-32601, `Method not found: ${method}`);
    }
}

/** One HTTP POST body: a message or (2025-03-26) a batch. */
export async function handleMcp(text: string, token: string, relay: Relay): Promise<McpOutcome> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { status: 400, body: rpcError(null, -32700, 'Parse error') };
    }
    const batch = Array.isArray(parsed);
    const messages = (batch ? parsed : [parsed]) as RpcMessage[];
    if (messages.length === 0 || messages.length > 20) return { status: 400, body: rpcError(null, -32600, 'Invalid request') };
    // One tool call per HTTP request, so the per-minute limit counts tool calls.
    if (messages.filter(m => m && typeof m === 'object' && m.method === 'tools/call').length > 1) {
        return { status: 400, body: rpcError(null, -32600, 'Send one tools/call per request.') };
    }
    const replies: unknown[] = [];
    for (const m of messages) {
        const r = await dispatch(m, token, relay);
        if (r === 'unauthorized') return { status: 401, unauthorized: true, body: { error: 'invalid_token', error_description: 'This connection was removed in the extension. Connect again.' } };
        if (r !== null) replies.push(r);
    }
    if (replies.length === 0) return { status: 202 };
    return { status: 200, body: batch ? replies : replies[0] };
}
