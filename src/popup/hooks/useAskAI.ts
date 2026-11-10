// SPDX-License-Identifier: AGPL-3.0-only
//
// Page side of Ask AI (docs/designs/ai-assistant.md). Lives at App level so a run
// keeps going while the user looks at other panels. The conversation is kept in
// chrome.storage.session (this browser session only, never synced or backed up).

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAISettings, getBoundApiKey, PROVIDERS, type AICloudConfig } from '../../lib/ai_settings_storage';
import { callModel, runAgent, NO_TOOLS, type Msg, type ToolCall } from '../../lib/agent/llm';
import type { ClientResponse } from '../../lib/bridge/protocol';

const SESSION_KEY = 'ask_ai_chat';
const MAX_KEPT_MESSAGES = 200;

/** What the panel shows, one entry per visible row. */
export type ChatItem =
    | { kind: 'user'; text: string }
    | { kind: 'assistant'; text: string }
    | { kind: 'tool'; label: string; failed?: boolean }
    | { kind: 'changes'; changeSetId: string; title: string; summary: string; skipped: number; undone?: boolean }
    | { kind: 'refused'; title: string; reasons: string[] }
    | { kind: 'error'; text: string };

export interface ProviderInfo {
    ready: boolean;
    /** Why it is not ready, in words for the user. */
    problem?: string;
    label: string;
    model: string;
    cloud?: AICloudConfig;
}

export interface AskAIApi {
    items: ChatItem[];
    running: boolean;
    provider: ProviderInfo | null;
    send: (text: string) => void;
    stop: () => void;
    clear: () => void;
    undo: (changeSetId: string) => Promise<{ ok: boolean; error?: string; undone?: number; skipped?: number }>;
    reloadProvider: () => void;
}

const OP_WORDS: Record<string, [string, string]> = {
    create_folder: ['folder created', 'folders created'],
    move: ['moved', 'moved'],
    rename: ['renamed', 'renamed'],
    set_tags: ['tagged', 'tagged'],
    set_rating: ['rated', 'rated'],
    trash: ['sent to Trash', 'sent to Trash'],
};

/** "3 folders created, 11 moved" from the ops the AI sent. */
export function summarizeOps(ops: unknown): string {
    if (!Array.isArray(ops)) return '';
    const counts = new Map<string, number>();
    for (const o of ops) {
        const k = (o as { op?: string })?.op;
        if (k && OP_WORDS[k]) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Object.keys(OP_WORDS).filter(k => counts.has(k)).map(k => {
        const n = counts.get(k)!;
        return `${n} ${OP_WORDS[k][n === 1 ? 0 : 1]}`;
    }).join(', ');
}

/**
 * Keep the last messages, cut only at a user message: a cut that splits a tool call
 * from its result, or starts on a reply, makes every provider refuse the next send.
 */
export function trimHistory(msgs: Msg[], max = MAX_KEPT_MESSAGES): Msg[] {
    if (msgs.length <= max) return msgs;
    const tail = msgs.slice(-max);
    const first = tail.findIndex(m => m.role === 'user');
    return first < 0 ? [] : tail.slice(first);
}

const str = (v: unknown, max = 60) => (typeof v === 'string' ? (v.length > max ? v.slice(0, max - 1) + '…' : v) : '');

/** One short line per tool call, for the activity chips. */
export function toolLabel(call: ToolCall): string {
    switch (call.name) {
        case 'list_folders': return 'Looked at your folders';
        case 'list_folder': return 'Opened a folder';
        case 'search': return `Searched for "${str(call.args.query, 40)}"`;
        case 'get_bookmark': return 'Looked at a bookmark';
        case 'apply_changes': return 'Made changes';
        case 'undo_changes': return 'Undid changes';
        case 'get_change_set': return 'Checked earlier changes';
        default: return call.name;
    }
}

/** Turn finished tool calls into rows: change cards, refusals, chips. */
export function itemsForTool(call: ToolCall, result: unknown): ChatItem[] {
    const res = (result as { res?: ClientResponse; ok?: boolean; error?: string } | undefined);
    const r = res?.res;
    if (!r) return [{ kind: 'tool', label: toolLabel(call), failed: true }];
    if (!r.ok) return [{ kind: 'tool', label: `${toolLabel(call)}: ${r.error.message}`, failed: true }];
    if (call.name === 'apply_changes') {
        const b = r.body as { applied?: boolean; accepted?: boolean; changeSetId?: string; skipped?: unknown[]; message?: string; results?: Array<{ ok: boolean; reason?: string; change: number }> };
        const cs = call.args.changeSet as { title?: unknown; ops?: unknown } | undefined;
        const title = str(cs?.title, 80) || 'Changes';
        if (b.applied && b.changeSetId) {
            return [{ kind: 'changes', changeSetId: b.changeSetId, title, summary: summarizeOps(cs?.ops), skipped: Array.isArray(b.skipped) ? b.skipped.length : 0 }];
        }
        if (b.accepted === false) {
            const reasons = (b.results ?? []).filter(x => !x.ok).slice(0, 5).map(x => `Change ${x.change + 1}: ${x.reason ?? 'refused'}`);
            return [{ kind: 'refused', title, reasons }];
        }
    }
    if (call.name === 'undo_changes') return [{ kind: 'tool', label: String((r.body as { message?: string }).message ?? 'Undid changes') }];
    return [{ kind: 'tool', label: toolLabel(call) }];
}

async function readProvider(): Promise<ProviderInfo> {
    const { settings } = await loadAISettings();
    const meta = PROVIDERS.find(p => p.id === settings.cloud.provider);
    const label = meta?.label ?? settings.cloud.provider;
    const model = settings.cloud.model;
    if (settings.mode !== 'cloud') return { ready: false, label, model, problem: 'Ask AI needs an AI provider. Chrome\'s built-in AI cannot use tools.' };
    if (NO_TOOLS.has(settings.cloud.provider)) return { ready: false, label, model, problem: `${label} cannot use tools. Choose another provider.` };
    if (!model?.trim()) return { ready: false, label, model, problem: 'No model is set for your provider.' };
    const { key, mismatch } = await getBoundApiKey(settings.cloud.provider, settings.cloud.customUrl);
    const keyless = settings.cloud.provider === 'ollama' || settings.cloud.provider === 'custom';
    if (!keyless && (mismatch || !key)) return { ready: false, label, model, problem: mismatch ? 'Your API key was saved for another provider. Enter it again.' : 'No API key is saved yet.' };
    return { ready: true, label, model, cloud: settings.cloud };
}

export function useAskAI(enabled = true): AskAIApi {
    const [items, setItems] = useState<ChatItem[]>([]);
    const [running, setRunning] = useState(false);
    const [provider, setProvider] = useState<ProviderInfo | null>(null);
    const history = useRef<Msg[]>([]);
    const abort = useRef<AbortController | null>(null);
    const loaded = useRef(false);

    const persist = useCallback((nextItems: ChatItem[]) => {
        const keep = { items: nextItems.slice(-MAX_KEPT_MESSAGES), history: trimHistory(history.current) };
        chrome.storage.session?.set({ [SESSION_KEY]: keep }).catch(() => undefined);
    }, []);

    const reloadProvider = useCallback(() => { void readProvider().then(setProvider).catch(() => setProvider({ ready: false, label: '', model: '', problem: 'Could not read AI settings.' })); }, []);

    useEffect(() => {
        if (!enabled) return;
        reloadProvider();
        if (loaded.current) return;
        loaded.current = true;
        chrome.storage.session?.get(SESSION_KEY).then(got => {
            const saved = got?.[SESSION_KEY] as { items?: ChatItem[]; history?: Msg[] } | undefined;
            if (saved?.items?.length) { setItems(saved.items); history.current = saved.history ?? []; }
        }).catch(() => undefined);
    }, [enabled, reloadProvider]);

    const add = useCallback((more: ChatItem[]) => {
        setItems(prev => { const next = [...prev, ...more]; persist(next); return next; });
    }, [persist]);

    const send = useCallback((textRaw: string) => {
        const text = textRaw.trim();
        if (!text || running) return;
        add([{ kind: 'user', text }]);
        setRunning(true);
        const ctl = new AbortController();
        abort.current = ctl;
        void (async () => {
            try {
                const p = await readProvider();
                setProvider(p);
                if (!p.ready || !p.cloud) { add([{ kind: 'error', text: p.problem ?? 'Ask AI is not set up.' }]); return; }
                const cloud = p.cloud;
                const { key } = await getBoundApiKey(cloud.provider, cloud.customUrl);
                const added = await runAgent(history.current, text, {
                    signal: ctl.signal,
                    model: (msgs, signal) => callModel(cloud, key, msgs, signal),
                    tool: async (name, args) => {
                        const r = await chrome.runtime.sendMessage({ type: 'AGENT_TOOL', name, args }) as { ok: boolean; res?: ClientResponse; error?: string } | undefined;
                        if (!r?.ok) return { error: r?.error ?? 'The extension did not answer.' };
                        return r.res;
                    },
                    onEvent: (e) => {
                        if (e.kind === 'text') add([{ kind: 'assistant', text: e.text }]);
                        else if (e.kind === 'tool_done') {
                            const res = e.result as ClientResponse | { error: string };
                            add(itemsForTool(e.call, 'error' in res && !('ok' in res) ? undefined : { res: res as ClientResponse }));
                        }
                    },
                });
                history.current = trimHistory([...history.current, ...added]);
            } catch (err) {
                const aborted = ctl.signal.aborted;
                add([{ kind: 'error', text: aborted ? 'Stopped.' : (err instanceof Error ? err.message : String(err)) }]);
                // Keep the transcript valid for every provider (no tool call left without its result).
                history.current = trimHistory([...history.current, { role: 'user' as const, text },
                    { role: 'assistant' as const, text: 'That request stopped before it finished. Changes already made, if any, are listed above with Undo.', calls: [] }]);
            } finally {
                abort.current = null;
                setRunning(false);
                setItems(prev => { persist(prev); return prev; });
            }
        })();
    }, [running, add, persist]);

    return {
        items,
        running,
        provider,
        send,
        stop: () => abort.current?.abort(),
        clear: () => { abort.current?.abort(); history.current = []; setItems([]); chrome.storage.session?.remove(SESSION_KEY).catch(() => undefined); },
        undo: async (changeSetId) => {
            const r = await chrome.runtime.sendMessage({ type: 'CS_UNDO', id: changeSetId }).catch(() => null) as { ok: boolean; error?: string; undone?: number; skipped?: number } | null;
            if (r?.ok) setItems(prev => { const next = prev.map(it => (it.kind === 'changes' && it.changeSetId === changeSetId ? { ...it, undone: true } : it)); persist(next); return next; });
            return r ?? { ok: false, error: 'The extension did not answer.' };
        },
        reloadProvider,
    };
}
