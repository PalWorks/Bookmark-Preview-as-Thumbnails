// SPDX-License-Identifier: AGPL-3.0-only
// Ask AI (D20): provider adapters, the tool loop, chat rows, and the tool list every surface shares.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    toOpenAI, fromOpenAI, toAnthropic, fromAnthropic, toGemini, fromGemini, geminiSchema, runAgent, callModel,
    type Msg, type ModelReply,
} from '../src/lib/agent/llm';
import { summarizeOps, itemsForTool, toolLabel, trimHistory } from '../src/popup/hooks/useAskAI';
import { TOOL_DEFS, pickArgs, findTool } from '../src/lib/bridge/tools';
import { REQUEST_TYPES } from '../src/lib/bridge/protocol';

const transcript: Msg[] = [
    { role: 'user', text: 'tidy' },
    { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'list_folders', args: {} }, { id: 'c2', name: 'search', args: { query: 'x' } }] },
    { role: 'tool', id: 'c1', name: 'list_folders', result: '{"ok":true}' },
    { role: 'tool', id: 'c2', name: 'search', result: '{"ok":true}' },
    { role: 'assistant', text: 'Done.', calls: [] },
];

describe('tool list', () => {
    it('every tool maps onto a bridge request and picks only its own arguments', () => {
        for (const t of TOOL_DEFS) {
            expect(REQUEST_TYPES).toContain(t.request);
            expect(t.description.length).toBeGreaterThan(20);
        }
        expect(pickArgs(findTool('search')!, { query: 'a', token: 'steal', limit: 3 })).toEqual({ query: 'a', limit: 3 });
        expect(findTool('pair')).toBeUndefined();
        expect(TOOL_DEFS.filter(t => !t.readOnly).map(t => t.name).sort()).toEqual(['apply_changes', 'undo_changes']);
    });
});

describe('provider adapters', () => {
    it('OpenAI: tool calls and results keep their ids', () => {
        const m = toOpenAI('sys', transcript) as Array<Record<string, unknown>>;
        expect(m[0]).toEqual({ role: 'system', content: 'sys' });
        expect((m[2].tool_calls as unknown[]).length).toBe(2);
        expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
        const r = fromOpenAI({ choices: [{ message: { content: null, tool_calls: [{ id: 'a', function: { name: 'search', arguments: '{"query":"q"}' } }, { id: 'b', function: { name: 'list_folders', arguments: 'not json' } }] } }] });
        expect(r.calls).toEqual([{ id: 'a', name: 'search', args: { query: 'q' } }, { id: 'b', name: 'list_folders', args: {} }]);
        expect(r.text).toBe('');
    });

    it('Anthropic: tool results go back in one user turn', () => {
        const m = toAnthropic(transcript) as Array<{ role: string; content: Array<{ type: string }> }>;
        expect(m.map(x => x.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
        expect(m[2].content.map(c => c.type)).toEqual(['tool_result', 'tool_result']);
        const r = fromAnthropic({ content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'search', input: { query: 'q' } }] });
        expect(r).toEqual({ text: 'Looking.', calls: [{ id: 't1', name: 'search', args: { query: 'q' } }] });
    });

    it('Gemini: function responses are objects; schemas keep only keys Gemini knows', () => {
        const m = toGemini(transcript) as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
        expect(m.map(x => x.role)).toEqual(['user', 'model', 'user', 'model']);
        expect(m[2].parts[0]).toEqual({ functionResponse: { name: 'list_folders', response: { ok: true } } });
        const r = fromGemini({ candidates: [{ content: { parts: [{ functionCall: { name: 'search', args: { query: 'q' } } }] } }] });
        expect(r.calls[0]).toMatchObject({ name: 'search', args: { query: 'q' } });
        const s = JSON.stringify(geminiSchema(findTool('list_folder')!.inputSchema));
        expect(s).not.toContain('minimum');
        expect(s).toContain('"required":["id"]');
    });
});

describe('callModel', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends the key in a header, never the URL, and offers every tool', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) });
        vi.stubGlobal('fetch', fetchMock);
        const r = await callModel({ provider: 'gemini', model: 'gemini-2.5-flash' }, 'AIzaSECRET', [{ role: 'user', text: 'hi' }]);
        expect(r.text).toBe('hi');
        const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
        expect(url).not.toContain('AIzaSECRET');
        expect(init.headers['x-goog-api-key']).toBe('AIzaSECRET');
        expect(JSON.parse(init.body).tools[0].functionDeclarations).toHaveLength(TOOL_DEFS.length);
    });

    it('refuses a provider without tool calling and reports provider errors with the status', async () => {
        await expect(callModel({ provider: 'perplexity', model: 'sonar' }, 'k', [])).rejects.toThrow(/cannot use tools/);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }));
        await expect(callModel({ provider: 'openai', model: 'gpt-4o-mini' }, 'k', [])).rejects.toThrow(/401/);
    });
});

describe('runAgent', () => {
    it('runs tools until the model answers in words', async () => {
        const replies: ModelReply[] = [
            { text: '', calls: [{ id: '1', name: 'search', args: { query: 'r' } }] },
            { text: '', calls: [{ id: '2', name: 'apply_changes', args: { changeSet: { ops: [] } } }] },
            { text: 'Moved 3 recipes.', calls: [] },
        ];
        const model = vi.fn(async () => replies.shift()!);
        const tool = vi.fn(async (name: string) => ({ ok: true, body: { name } }));
        const events: string[] = [];
        const added = await runAgent([], 'sort recipes', { model, tool, onEvent: e => events.push(e.kind) });
        expect(tool.mock.calls.map(c => c[0])).toEqual(['search', 'apply_changes']);
        expect(added.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
        expect(events).toEqual(['tool_start', 'tool_done', 'tool_start', 'tool_done', 'text']);
    });

    it('stops runaway tool use and tells the model why', async () => {
        const model = vi.fn(async (msgs: Msg[]) => (msgs.filter(m => m.role === 'tool').length > 20
            ? { text: 'ok', calls: [] }
            : { text: '', calls: [{ id: String(msgs.length), name: 'list_folders', args: {} }] }));
        const tool = vi.fn(async () => ({ ok: true }));
        const added = await runAgent([], 'go', { model, tool, maxSteps: 3 });
        expect(tool).toHaveBeenCalledTimes(3);
        expect(added.some(m => m.role === 'tool' && m.result.includes('Stopped'))).toBe(true);
    });

    it('a tool that throws becomes an error result, not a crash', async () => {
        const replies: ModelReply[] = [{ text: '', calls: [{ id: '1', name: 'search', args: {} }] }, { text: 'Sorry.', calls: [] }];
        const added = await runAgent([], 'x', { model: async () => replies.shift()!, tool: async () => { throw new Error('boom'); } });
        expect(added.find(m => m.role === 'tool')).toMatchObject({ result: '{"error":"boom"}' });
    });
});

describe('chat rows', () => {
    it('summarises a change set in words', () => {
        expect(summarizeOps([{ op: 'create_folder' }, { op: 'move' }, { op: 'move' }, { op: 'trash' }])).toBe('1 folder created, 2 moved, 1 sent to Trash');
        expect(toolLabel({ id: '1', name: 'search', args: { query: 'recipes' } })).toBe('Searched for "recipes"');
    });

    it('an applied set becomes a card with Undo; a refused one lists reasons', () => {
        const call = { id: '1', name: 'apply_changes', args: { changeSet: { title: 'Sort', ops: [{ op: 'move' }] } } };
        expect(itemsForTool(call, { res: { v: 1, id: 0, ok: true, body: { applied: true, changeSetId: 'cs1', skipped: [] } } }))
            .toEqual([{ kind: 'changes', changeSetId: 'cs1', title: 'Sort', summary: '1 moved', skipped: 0, targets: [] }]);
        expect(itemsForTool(call, { res: { v: 1, id: 0, ok: true, body: { accepted: false, results: [{ change: 0, ok: false, reason: 'Unknown id' }] } } }))
            .toEqual([{ kind: 'refused', title: 'Sort', reasons: ['Change 1: Unknown id'] }]);
        expect(itemsForTool(call, undefined)[0]).toMatchObject({ kind: 'tool', failed: true });
    });
});

describe('history trimming (review D20-2)', () => {
    it('cuts only at a user message, so no tool result loses its call', () => {
        const turn = (i: number): Msg[] => [
            { role: 'user', text: `u${i}` },
            { role: 'assistant', text: '', calls: [{ id: `c${i}`, name: 'search', args: {} }] },
            { role: 'tool', id: `c${i}`, name: 'search', result: '{}' },
            { role: 'assistant', text: 'ok', calls: [] },
        ];
        const all = Array.from({ length: 10 }, (_, i) => turn(i)).flat();
        const kept = trimHistory(all, 10);
        expect(kept[0]).toEqual({ role: 'user', text: 'u8' });
        expect(kept).toHaveLength(8);
        expect(trimHistory(all, 1000)).toBe(all);
    });
});
