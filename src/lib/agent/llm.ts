// SPDX-License-Identifier: AGPL-3.0-only
//
// Ask AI: a small tool-calling loop over the provider the user set up in AI
// settings (docs/designs/ai-assistant.md). Three wire formats: OpenAI-compatible
// chat completions (most providers, Ollama, custom), Anthropic Messages and
// Gemini generateContent. The loop is provider-neutral; each adapter converts the
// neutral transcript to its own format. Runs in the extension page.

import type { AICloudConfig } from '../ai_settings_storage';
import { PROVIDERS } from '../ai_settings_storage';
import { TOOL_DEFS, AGENT_INSTRUCTIONS } from '../bridge/tools';
import { fetchWithRetry, providerError, openAIBody, replyBudget, geminiThinkingConfig, wasCutAtBudget, EmptyReplyError } from '../ai_provider_rules';

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

/** Neutral transcript. */
export type Msg =
    | { role: 'user'; text: string }
    | { role: 'assistant'; text: string; calls: ToolCall[] }
    | { role: 'tool'; id: string; name: string; result: string };

export interface ModelReply { text: string; calls: ToolCall[] }

export type AgentEvent =
    | { kind: 'tool_start'; call: ToolCall }
    | { kind: 'tool_done'; call: ToolCall; result: unknown }
    | { kind: 'text'; text: string };

export const MAX_TOOL_STEPS = 12;
const MAX_RESULT_CHARS = 24_000;
const CALL_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 4096;

/** Providers whose API has no tool calling. */
export const NO_TOOLS = new Set(['perplexity']);

export function systemPrompt(): string {
    return `${AGENT_INSTRUCTIONS} Today is ${new Date().toISOString().slice(0, 10)}. Answer in the user's language. Keep replies short.`;
}

async function postJson(provider: AICloudConfig['provider'], url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const resp = await fetchWithRetry(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }, { signal, timeoutMs: CALL_TIMEOUT_MS });
    if (!resp.ok) throw providerError(provider, resp.status, await resp.text().catch(() => ''));
    return resp.json();
}

/** A 200 with no answer and no tool call, cut at the budget, is a failure (kit rule 2). */
function checked(reply: ModelReply, data: unknown): ModelReply {
    if (!reply.text && !reply.calls.length && wasCutAtBudget(data)) throw new EmptyReplyError();
    return reply;
}

let idSeq = 0;
const newId = () => `call_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

function parseArgs(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

// ── OpenAI-compatible ───────────────────────────────────────────────────────

export function openAIEndpoint(cloud: AICloudConfig): string {
    if (cloud.provider === 'ollama') return (cloud.customUrl?.replace(/\/$/, '') || 'http://localhost:11434') + '/v1/chat/completions';
    if (cloud.provider === 'custom') {
        if (!cloud.customUrl) throw new Error('Custom endpoint URL not configured. Open AI settings.');
        return cloud.customUrl.replace(/\/$/, '') + '/chat/completions';
    }
    const meta = PROVIDERS.find(p => p.id === cloud.provider);
    return meta?.endpoint ?? 'https://api.openai.com/v1/chat/completions';
}

export function toOpenAI(system: string, msgs: Msg[]): unknown[] {
    const out: unknown[] = [{ role: 'system', content: system }];
    for (const m of msgs) {
        if (m.role === 'user') out.push({ role: 'user', content: m.text });
        else if (m.role === 'assistant') {
            out.push({
                role: 'assistant', content: m.text || null,
                ...(m.calls.length ? { tool_calls: m.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
            });
        } else out.push({ role: 'tool', tool_call_id: m.id, content: m.result });
    }
    return out;
}

export function fromOpenAI(data: unknown): ModelReply {
    const msg = (data as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> } }> }).choices?.[0]?.message;
    return {
        text: typeof msg?.content === 'string' ? msg.content : '',
        calls: (msg?.tool_calls ?? []).filter(c => c.function?.name).map(c => ({ id: c.id || newId(), name: c.function!.name!, args: parseArgs(c.function!.arguments) })),
    };
}

// ── Anthropic ───────────────────────────────────────────────────────────────

export function toAnthropic(msgs: Msg[]): unknown[] {
    const out: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = [];
    const push = (role: 'user' | 'assistant', block: unknown) => {
        const last = out[out.length - 1];
        if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] });
    };
    for (const m of msgs) {
        if (m.role === 'user') push('user', { type: 'text', text: m.text });
        else if (m.role === 'assistant') {
            if (m.text) push('assistant', { type: 'text', text: m.text });
            for (const c of m.calls) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args });
            if (!m.text && !m.calls.length) push('assistant', { type: 'text', text: '(no reply)' });
        } else push('user', { type: 'tool_result', tool_use_id: m.id, content: m.result });
    }
    return out;
}

export function fromAnthropic(data: unknown): ModelReply {
    const blocks = (data as { content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }> }).content ?? [];
    return {
        text: blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim(),
        calls: blocks.filter(b => b.type === 'tool_use' && b.name).map(b => ({ id: b.id || newId(), name: b.name!, args: parseArgs(b.input) })),
    };
}

// ── Gemini ──────────────────────────────────────────────────────────────────

const GEMINI_SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable', 'format']);

/** Gemini accepts an OpenAPI subset: keep only the keys it knows. */
export function geminiSchema(s: unknown): unknown {
    if (Array.isArray(s)) return s.map(geminiSchema);
    if (!s || typeof s !== 'object') return s;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
        if (!GEMINI_SCHEMA_KEYS.has(k)) continue;
        if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, geminiSchema(pv)]));
        else out[k] = geminiSchema(v);
    }
    return out;
}

export function toGemini(msgs: Msg[]): unknown[] {
    const out: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];
    const push = (role: 'user' | 'model', part: unknown) => {
        const last = out[out.length - 1];
        if (last && last.role === role) last.parts.push(part); else out.push({ role, parts: [part] });
    };
    for (const m of msgs) {
        if (m.role === 'user') push('user', { text: m.text });
        else if (m.role === 'assistant') {
            if (m.text) push('model', { text: m.text });
            for (const c of m.calls) push('model', { functionCall: { name: c.name, args: c.args } });
            if (!m.text && !m.calls.length) push('model', { text: '(no reply)' });
        } else {
            let response: unknown;
            try { response = JSON.parse(m.result); } catch { response = { result: m.result }; }
            push('user', { functionResponse: { name: m.name, response: response && typeof response === 'object' && !Array.isArray(response) ? response : { result: response } } });
        }
    }
    return out;
}

export function fromGemini(data: unknown): ModelReply {
    const parts = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> } }> }).candidates?.[0]?.content?.parts ?? [];
    return {
        text: parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n').trim(),
        calls: parts.filter(p => p.functionCall?.name).map(p => ({ id: newId(), name: p.functionCall!.name!, args: parseArgs(p.functionCall!.args) })),
    };
}

// ── One model turn ──────────────────────────────────────────────────────────

export async function callModel(cloud: AICloudConfig, apiKey: string, msgs: Msg[], signal?: AbortSignal): Promise<ModelReply> {
    const system = systemPrompt();
    if (NO_TOOLS.has(cloud.provider)) throw new Error('This provider cannot use tools. Choose another provider in AI settings to use Ask AI.');
    if (cloud.provider === 'anthropic') {
        const data = await postJson('anthropic', 'https://api.anthropic.com/v1/messages', {
            'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
        }, {
            model: cloud.model, system, max_tokens: replyBudget('anthropic', cloud.model, MAX_OUTPUT_TOKENS), messages: toAnthropic(msgs),
            tools: TOOL_DEFS.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        }, signal);
        return checked(fromAnthropic(data), data);
    }
    if (cloud.provider === 'gemini') {
        // Key in a header, never the URL.
        // Thinking on (dynamic) helps tool use; the headroom keeps it from eating the answer.
        const thinking = geminiThinkingConfig(cloud.model, true);
        const data = await postJson('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cloud.model)}:generateContent`, { 'x-goog-api-key': apiKey }, {
            system_instruction: { parts: [{ text: system }] },
            contents: toGemini(msgs),
            tools: [{ functionDeclarations: TOOL_DEFS.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(t.inputSchema) })) }],
            generationConfig: {
                maxOutputTokens: replyBudget('gemini', cloud.model, MAX_OUTPUT_TOKENS, true), temperature: 0.2,
                ...(thinking ? { thinkingConfig: thinking } : {}),
            },
        }, signal);
        return checked(fromGemini(data), data);
    }
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const data = await postJson(cloud.provider, openAIEndpoint(cloud), headers, openAIBody(
        cloud.provider, cloud.model, toOpenAI(system, msgs), replyBudget(cloud.provider, cloud.model, MAX_OUTPUT_TOKENS),
        { tools: TOOL_DEFS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) },
    ), signal);
    return checked(fromOpenAI(data), data);
}

// ── The loop ────────────────────────────────────────────────────────────────

export interface RunOptions {
    /** One model turn (callModel, or a fake in tests). */
    model: (msgs: Msg[], signal?: AbortSignal) => Promise<ModelReply>;
    /** Run one tool; returns the bridge response. */
    tool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    onEvent?: (e: AgentEvent) => void;
    signal?: AbortSignal;
    maxSteps?: number;
}

/** Continue the transcript from a new user message until the model stops calling tools. Returns the new messages. */
export async function runAgent(history: Msg[], userText: string, opts: RunOptions): Promise<Msg[]> {
    const added: Msg[] = [{ role: 'user', text: userText }];
    const max = opts.maxSteps ?? MAX_TOOL_STEPS;
    let steps = 0;
    for (;;) {
        opts.signal?.throwIfAborted();
        const reply = await opts.model([...history, ...added], opts.signal);
        added.push({ role: 'assistant', text: reply.text, calls: reply.calls });
        if (reply.text) opts.onEvent?.({ kind: 'text', text: reply.text });
        if (!reply.calls.length) return added;
        for (const call of reply.calls) {
            opts.signal?.throwIfAborted();
            steps++;
            let result: unknown;
            if (steps > max) {
                result = { error: `Stopped: more than ${max} tool calls for one message. Tell the user what is done and what is left.` };
            } else {
                opts.onEvent?.({ kind: 'tool_start', call });
                try { result = await opts.tool(call.name, call.args); } catch (err) { result = { error: err instanceof Error ? err.message : String(err) }; }
                opts.onEvent?.({ kind: 'tool_done', call, result });
            }
            let text = JSON.stringify(result ?? null);
            if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + '... (cut: ask for fewer items with limit and cursor)';
            added.push({ role: 'tool', id: call.id, name: call.name, result: text });
        }
        if (steps > max + 2) {
            added.push({ role: 'assistant', text: 'I stopped after too many steps. Ask me to continue if needed.', calls: [] });
            return added;
        }
    }
}
