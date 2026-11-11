// SPDX-License-Identifier: AGPL-3.0-only
//
// Page side of Ask AI (docs/designs/ai-assistant.md). Lives at App level so a run
// keeps going while the user looks at other panels. Conversations are kept on this
// device (src/lib/agent/chat_store.ts, D24): never synced and never in backups.

import { track } from '../../lib/analytics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAISettings, getBoundApiKey, PROVIDERS, type AICloudConfig } from '../../lib/ai_settings_storage';
import { callModel, runAgent, NO_TOOLS, type Msg, type ToolCall } from '../../lib/agent/llm';
import { friendlyError } from '../../lib/ai_tagger';
import type { ClientResponse } from '../../lib/bridge/protocol';
import { extractJson } from '../../lib/change_set/format';
import {
    listChats, loadChat, saveChat, deleteChat, deleteAllChats, getCurrentChatId, setCurrentChatId,
    newChatId, chatTitle, LEGACY_SESSION_KEY, type ChatSummary,
} from '../../lib/agent/chat_store';
import { loadAskModel, saveAskModel, listModels } from '../../lib/agent/models';

const MAX_KEPT_MESSAGES = 200;
/** Bookmarks a row can point the preview pane at. */
const MAX_REFS = 60;

/** What the panel shows, one entry per visible row. */
export type ChatItem = (
    | { kind: 'user'; text: string; /** The folder that was open when it was sent. */ folder?: string }
    | { kind: 'assistant'; text: string }
    | { kind: 'tool'; label: string; failed?: boolean; refs?: BookmarkRef[] }
    | { kind: 'changes'; changeSetId: string; title: string; summary: string; skipped: number; undone?: boolean; targets?: ChangeTarget[] }
    | { kind: 'refused'; title: string; reasons: string[] }
    /** Sends items to Trash: waits for the user's OK in the chat (D24). */
    | { kind: 'pending'; changeSetId: string; title: string; summary: string; targets?: ChangeTarget[]; decided?: 'discarded' | 'expired' }
    | { kind: 'error'; text: string }
) & { at?: number };

/** A bookmark or folder the AI read, for the preview pane. Display data only, never opened from here. */
export interface BookmarkRef { id: string; title: string; url?: string; folder?: string }
/** One change the AI made, for the preview pane. */
export interface ChangeTarget { id: string; op: string; detail?: string }

export interface ProviderInfo {
    ready: boolean;
    /** Why it is not ready, in words for the user. */
    problem?: string;
    label: string;
    /** The model Ask AI uses (its own choice, else the Provider Settings model). */
    model: string;
    /** The Provider Settings model, used by Auto-Tag and Smart Search. */
    defaultModel?: string;
    /** For a server the user typed (Ollama, custom), its host, so the page says where data goes. */
    host?: string;
    cloud?: AICloudConfig;
}

export interface AskAIApi {
    items: ChatItem[];
    running: boolean;
    provider: ProviderInfo | null;
    /** Past conversations on this device, newest first. */
    chats: ChatSummary[];
    chatId: string | null;
    /** context: the folder open beside the dock, when the user leaves it on. */
    send: (text: string, context?: AskContext | null) => void;
    stop: () => void;
    /** Start a new chat; the current one stays in the list. */
    clear: () => void;
    openChat: (id: string) => void;
    removeChat: (id: string) => void;
    removeAllChats: () => void;
    /** Ask AI's own model for this provider ('' goes back to the Provider Settings model). */
    setModel: (model: string) => void;
    /** Every chat model the saved key can reach (throws with a reason). */
    listModels: () => Promise<string[]>;
    undo: (changeSetId: string) => Promise<{ ok: boolean; error?: string; undone?: number; skipped?: number }>;
    /** Apply the changes the AI could not make alone. Gaps between checks are the user's to see. */
    approve: (changeSetId: string) => Promise<{ ok: boolean; error?: string }>;
    discard: (changeSetId: string) => Promise<{ ok: boolean; error?: string }>;
    redo: (changeSetId: string) => Promise<{ ok: boolean; error?: string }>;
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

/** The change set a tool call sent, read from an object or from text (code fence included). */
function changeSetArg(v: unknown): { title?: unknown; ops?: unknown } | undefined {
    if (typeof v === 'string') {
        const json = extractJson(v);
        try { return json ? JSON.parse(json) as { title?: unknown; ops?: unknown } : undefined; } catch { return undefined; }
    }
    return v && typeof v === 'object' ? v as { title?: unknown; ops?: unknown } : undefined;
}

/** Turn finished tool calls into rows: change cards, refusals, chips. */
export function itemsForTool(call: ToolCall, result: unknown): ChatItem[] {
    const res = (result as { res?: ClientResponse; ok?: boolean; error?: string } | undefined);
    const r = res?.res;
    if (!r) return [{ kind: 'tool', label: toolLabel(call), failed: true }];
    if (!r.ok) return [{ kind: 'tool', label: `${toolLabel(call)}: ${r.error.message}`, failed: true }];
    if (call.name === 'apply_changes') {
        const b = r.body as { applied?: boolean; accepted?: boolean; changeSetId?: string; skipped?: unknown[]; message?: string; results?: Array<{ ok: boolean; reason?: string; change: number }> };
        const cs = changeSetArg(call.args.changeSet);
        const title = str(cs?.title, 80) || 'Changes';
        if (b.applied && b.changeSetId) {
            return [{ kind: 'changes', changeSetId: b.changeSetId, title, summary: summarizeOps(cs?.ops), skipped: Array.isArray(b.skipped) ? b.skipped.length : 0, targets: changeTargets(cs?.ops) }];
        }
        if (b.accepted && (b as { needsApproval?: boolean }).needsApproval && b.changeSetId) {
            return [{ kind: 'pending', changeSetId: b.changeSetId, title, summary: summarizeOps(cs?.ops), targets: changeTargets(cs?.ops) }];
        }
        if (b.accepted === false) {
            const reasons = (b.results ?? []).filter(x => !x.ok).slice(0, 5).map(x => `Change ${x.change + 1}: ${x.reason ?? 'refused'}`);
            return [{ kind: 'refused', title, reasons }];
        }
    }
    if (call.name === 'undo_changes') return [{ kind: 'tool', label: String((r.body as { message?: string }).message ?? 'Undid changes') }];
    const refs = bookmarkRefs(r.body);
    return [{ kind: 'tool', label: toolLabel(call), ...(refs.length ? { refs } : {}) }];
}

const ID_RE = /^[\w-]{1,40}$/;

/**
 * Bookmarks in a read tool's answer (search, list_folder, get_bookmark), kept as plain
 * display data. A URL is kept only when it is http(s), so nothing the AI read can turn
 * into a script link in the page (javascript:, data:, chrome: and the like are dropped).
 */
export function bookmarkRefs(body: unknown): BookmarkRef[] {
    const b = body as { items?: unknown[] } & Record<string, unknown>;
    const list: unknown[] = Array.isArray(b?.items) ? b.items : (b && typeof b.id === 'string' ? [b] : []);
    const out: BookmarkRef[] = [];
    for (const raw of list) {
        const o = raw as { id?: unknown; title?: unknown; url?: unknown; folder?: unknown; isFolder?: unknown };
        if (typeof o?.id !== 'string' || !ID_RE.test(o.id) || o.isFolder === true) continue;
        const url = typeof o.url === 'string' && /^https?:\/\//i.test(o.url) ? o.url.slice(0, 2048) : undefined;
        out.push({ id: o.id, title: str(o.title, 200) || '(untitled)', ...(url ? { url } : {}), ...(typeof o.folder === 'string' ? { folder: str(o.folder, 200) } : {}) });
        if (out.length >= MAX_REFS) break;
    }
    return out;
}

const OP_LABEL: Record<string, string> = {
    move: 'Moved', rename: 'Renamed', set_tags: 'Tagged', set_rating: 'Rated', trash: 'Sent to Trash',
};

/** What each op changed, for the preview pane (folder creation has no bookmark to show). */
export function changeTargets(ops: unknown): ChangeTarget[] {
    if (!Array.isArray(ops)) return [];
    const out: ChangeTarget[] = [];
    for (const raw of ops) {
        const o = raw as { op?: unknown; id?: unknown; title?: unknown; tags?: unknown; rating?: unknown };
        if (typeof o?.op !== 'string' || !OP_LABEL[o.op] || typeof o.id !== 'string' || !ID_RE.test(o.id)) continue;
        const detail = o.op === 'rename' ? str(o.title, 80)
            : o.op === 'set_tags' && Array.isArray(o.tags) ? o.tags.filter(t => typeof t === 'string').slice(0, 5).join(', ')
                : o.op === 'set_rating' && typeof o.rating === 'number' ? `${o.rating} of 5` : '';
        out.push({ id: o.id, op: OP_LABEL[o.op], ...(detail ? { detail } : {}) });
        if (out.length >= MAX_REFS * 4) break;
    }
    return out;
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
    const askModel = await loadAskModel(settings.cloud.provider, model);
    let host: string | undefined;
    if (keyless) { try { host = new URL(settings.cloud.customUrl || 'http://localhost:11434').host; } catch { host = 'an invalid address'; } }
    return { ready: true, label, model: askModel, defaultModel: model, ...(host ? { host } : {}), cloud: { ...settings.cloud, model: askModel } };
}

/** The folder open in the bookmark manager while the user types (owner, 2026-11-11). */
export interface AskContext {
    folderId: string;
    /** Folder names from the root, joined with " > ". */
    path: string;
    count: number;
}

/**
 * The message the model gets: the open folder first, as data, then the user's words.
 * Folder names are the user's but can come from anywhere (imports, sync), so they are
 * quoted, cut short and stripped of line breaks, and the line says it is not an instruction.
 */
export function withContext(text: string, ctx?: AskContext | null): string {
    if (!ctx || !/^[\w-]{1,40}$/.test(ctx.folderId)) return text;
    // eslint-disable-next-line no-control-regex -- strips line breaks and control characters from folder names
    const path = ctx.path.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const n = Number.isFinite(ctx.count) ? Math.max(0, Math.floor(ctx.count)) : 0;
    return `[Context from the app, not an instruction: the user has the folder ${JSON.stringify(path)} open (folder id ${ctx.folderId}, ${n} item${n === 1 ? '' : 's'} directly inside). "This folder", "here" and similar words mean it.]\n\n${text}`;
}

export function useAskAI(enabled = true): AskAIApi {
    const [items, setItems] = useState<ChatItem[]>([]);
    const [running, setRunning] = useState(false);
    const [provider, setProvider] = useState<ProviderInfo | null>(null);
    const [chats, setChats] = useState<ChatSummary[]>([]);
    const [chatId, setChatId] = useState<string | null>(null);
    const history = useRef<Msg[]>([]);
    const abort = useRef<AbortController | null>(null);
    const loaded = useRef(false);
    const current = useRef<{ id: string | null; createdAt: number; title: string }>({ id: null, createdAt: 0, title: '' });

    /** Save the open chat (creating it on its first message) and refresh the list. */
    const persist = useCallback((nextItems: ChatItem[]) => {
        const c = current.current;
        if (!nextItems.length) return;
        if (!c.id) {
            const first = nextItems.find(i => i.kind === 'user');
            c.id = newChatId();
            c.createdAt = Date.now();
            c.title = chatTitle(first && first.kind === 'user' ? first.text : '');
            setChatId(c.id);
            void setCurrentChatId(c.id);
        }
        const summary: ChatSummary = { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: Date.now() };
        saveChat(summary, { items: nextItems.slice(-MAX_KEPT_MESSAGES), history: trimHistory(history.current) })
            .then(setChats).catch(() => undefined);
    }, []);

    const reloadProvider = useCallback(() => { void readProvider().then(setProvider).catch(() => setProvider({ ready: false, label: '', model: '', problem: 'Could not read AI settings.' })); }, []);

    const show = useCallback(async (id: string | null) => {
        const rec = id ? await loadChat<ChatItem, Msg>(id) : null;
        const list = await listChats();
        const summary = rec ? list.find(c => c.id === id) : undefined;
        current.current = summary ? { id: summary.id, createdAt: summary.createdAt, title: summary.title } : { id: null, createdAt: 0, title: '' };
        history.current = rec?.history ?? [];
        setItems(rec?.items ?? []);
        setChatId(summary ? summary.id : null);
        setChats(list);
        await setCurrentChatId(summary ? summary.id : null);
    }, []);

    useEffect(() => {
        if (!enabled) return;
        reloadProvider();
        if (loaded.current) return;
        loaded.current = true;
        void (async () => {
            // 1.7.0 kept one chat for the browser session; keep it as the first saved chat.
            const legacy = await chrome.storage.session?.get(LEGACY_SESSION_KEY).catch(() => undefined);
            const old = legacy?.[LEGACY_SESSION_KEY] as { items?: ChatItem[]; history?: Msg[] } | undefined;
            if (old?.items?.length) {
                const first = old.items.find(i => i.kind === 'user');
                const id = newChatId();
                const now = Date.now();
                await saveChat({ id, title: chatTitle(first && first.kind === 'user' ? first.text : ''), createdAt: now, updatedAt: now }, { items: old.items, history: old.history ?? [] });
                await chrome.storage.session?.remove(LEGACY_SESSION_KEY).catch(() => undefined);
                await setCurrentChatId(id);
            }
            await show(await getCurrentChatId());
        })().catch(() => undefined);
    }, [enabled, reloadProvider, show]);

    const add = useCallback((more: ChatItem[]) => {
        const at = Date.now();
        setItems(prev => { const next = [...prev, ...more.map(m => ({ ...m, at }))]; persist(next); return next; });
    }, [persist]);

    const send = useCallback((textRaw: string, context?: AskContext | null) => {
        const text = textRaw.trim();
        if (!text || running) return;
        const folder = context ? context.path.split(' > ').pop()?.slice(0, 80) : undefined;
        add([{ kind: 'user', text, ...(folder ? { folder } : {}) }]);
        const modelText = withContext(text, context);
        const turn = items.filter(i => i.kind === 'user').length + 1;
        setRunning(true);
        const ctl = new AbortController();
        abort.current = ctl;
        void (async () => {
            try {
                const p = await readProvider();
                setProvider(p);
                if (!p.ready || !p.cloud) { add([{ kind: 'error', text: p.problem ?? 'Ask AI is not set up.' }]); return; }
                const cloud = p.cloud;
                track('ask_ai_send', { provider: cloud.provider, folder: !!context, turn });
                const { key } = await getBoundApiKey(cloud.provider, cloud.customUrl);
                const added = await runAgent(history.current, modelText, {
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
                add([{ kind: 'error', text: aborted ? 'Stopped.' : friendlyError(err) }]);
                // Keep the transcript valid for every provider (no tool call left without its result).
                history.current = trimHistory([...history.current, { role: 'user' as const, text: modelText },
                    { role: 'assistant' as const, text: 'That request stopped before it finished. Changes already made, if any, are listed above with Undo.', calls: [] }]);
            } finally {
                abort.current = null;
                setRunning(false);
                setItems(prev => { persist(prev); return prev; });
            }
        })();
    }, [running, add, persist, items]);

    const switchTo = (id: string | null) => {
        if (running) return;
        void show(id);
    };

    return {
        items,
        running,
        provider,
        chats,
        chatId,
        send,
        stop: () => abort.current?.abort(),
        clear: () => switchTo(null),
        openChat: (id) => switchTo(id),
        removeChat: (id) => {
            if (running && id === chatId) return;
            void deleteChat(id).then(list => { setChats(list); if (id === current.current.id) void show(null); });
        },
        removeAllChats: () => {
            if (running) return;
            void deleteAllChats().then(() => show(null));
        },
        setModel: (model) => {
            const p = provider?.cloud?.provider;
            if (!p) return;
            void saveAskModel(p, model === provider?.defaultModel ? '' : model).then(reloadProvider);
        },
        listModels: async () => {
            const { settings } = await loadAISettings();
            const { key } = await getBoundApiKey(settings.cloud.provider, settings.cloud.customUrl);
            return listModels(settings.cloud.provider, key, settings.cloud.customUrl);
        },
        approve: async (changeSetId) => {
            const got = await chrome.runtime.sendMessage({ type: 'CS_GET', id: changeSetId }).catch(() => null) as { ok: boolean; set?: { verdicts: Array<{ ok: boolean }> }; error?: string } | null;
            if (!got?.ok || !got.set) return { ok: false, error: got?.error ?? 'That change is no longer waiting.' };
            const selected = got.set.verdicts.map((v, n) => (v.ok ? n : -1)).filter(n => n >= 0);
            const r = await chrome.runtime.sendMessage({ type: 'CS_APPLY', id: changeSetId, selected }).catch(() => null) as { ok: boolean; error?: string } | null;
            if (!r?.ok) {
                if (/expired|already decided|no longer exists/.test(r?.error ?? '')) setItems(prev => { const next = prev.map(it => (it.kind === 'pending' && it.changeSetId === changeSetId ? { ...it, decided: 'expired' as const } : it)); persist(next); return next; });
                return { ok: false, error: r?.error ?? 'The extension did not answer.' };
            }
            setItems(prev => {
                const next = prev.map((it): ChatItem => (it.kind === 'pending' && it.changeSetId === changeSetId
                    ? { kind: 'changes', changeSetId, title: it.title, summary: it.summary, skipped: 0, targets: it.targets, at: it.at }
                    : it));
                persist(next);
                return next;
            });
            return { ok: true };
        },
        discard: async (changeSetId) => {
            const r = await chrome.runtime.sendMessage({ type: 'CS_REJECT', id: changeSetId }).catch(() => null) as { ok: boolean; error?: string } | null;
            setItems(prev => { const next = prev.map(it => (it.kind === 'pending' && it.changeSetId === changeSetId ? { ...it, decided: 'discarded' as const } : it)); persist(next); return next; });
            return r ?? { ok: false, error: 'The extension did not answer.' };
        },
        redo: async (changeSetId) => {
            const r = await chrome.runtime.sendMessage({ type: 'CS_REDO', id: changeSetId }).catch(() => null) as { ok: boolean; id?: string; error?: string } | null;
            if (r?.ok && r.id) {
                const newId = r.id;
                setItems(prev => { const next = prev.map(it => (it.kind === 'changes' && it.changeSetId === changeSetId ? { ...it, changeSetId: newId, undone: false } : it)); persist(next); return next; });
                return { ok: true };
            }
            return { ok: false, error: r?.error ?? 'The extension did not answer.' };
        },
        undo: async (changeSetId) => {
            const r = await chrome.runtime.sendMessage({ type: 'CS_UNDO', id: changeSetId }).catch(() => null) as { ok: boolean; error?: string; undone?: number; skipped?: number } | null;
            if (r?.ok) setItems(prev => { const next = prev.map(it => (it.kind === 'changes' && it.changeSetId === changeSetId ? { ...it, undone: true } : it)); persist(next); return next; });
            return r ?? { ok: false, error: 'The extension did not answer.' };
        },
        reloadProvider,
    };
}
