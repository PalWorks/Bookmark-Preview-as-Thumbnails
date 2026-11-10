// SPDX-License-Identifier: AGPL-3.0-only
//
// Usage statistics (D27, owner 2026-11-11): which features are used, so the product can
// follow real use. On by default; the user turns it off in the settings menu.
//
// What leaves the device: a random install id, a session number, the extension version,
// and event names with a few small values (a feature name, a count, on or off). Never a
// link, title, folder name, search text, chat text or key: values must be numbers,
// booleans, or short words without spaces or slashes, and the relay checks this again.
// Events go to our own relay (the feedback Worker), which passes them to Google
// Analytics and PostHog with its own keys; the extension holds no analytics key.

import { STORE_EXTENSION_ID } from './bridge/protocol';

export const ANALYTICS_ENDPOINT = 'https://bookmarks-feedback.palworks.ai/events';
/** sync: false when the user turned usage statistics off; absent means on. */
export const USAGE_STATS_KEY = 'usage_stats';
const CID_KEY = 'analytics_cid';
const SID_KEY = 'analytics_sid';
const MAX_BATCH = 20;
const FLUSH_MS = 2000;

export type EventValue = string | number | boolean;
export type EventParams = Record<string, EventValue>;
interface QueuedEvent { n: string; p: EventParams; t: number }

const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const KEY = /^[a-z][a-z0-9_]{0,29}$/;
/** A short word: no spaces, slashes or anything that could carry a link or a title. */
const WORD = /^[A-Za-z0-9_.:-]{0,40}$/;

/** Keep only values that cannot carry personal content. Exported for tests. */
export function safeParams(p: Record<string, unknown> = {}): EventParams {
    const out: EventParams = {};
    for (const [k, v] of Object.entries(p).slice(0, 10)) {
        if (!KEY.test(k)) continue;
        if (typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
        else if (typeof v === 'string' && WORD.test(v)) out[k] = v;
    }
    return out;
}

/** Counts are sent as buckets, never exact library sizes. */
export function bucket(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n === 1) return '1';
    if (n <= 10) return '2-10';
    if (n <= 100) return '11-100';
    if (n <= 1000) return '101-1000';
    return '1000+';
}

const incognito = () => typeof chrome !== 'undefined' && chrome.extension?.inIncognitoContext === true;

export async function usageStatsEnabled(): Promise<boolean> {
    try {
        const got = await chrome.storage.sync.get(USAGE_STATS_KEY);
        return got?.[USAGE_STATS_KEY] !== false;
    } catch {
        return true;
    }
}

export async function setUsageStats(on: boolean): Promise<void> {
    if (on) await chrome.storage.sync.remove(USAGE_STATS_KEY);
    else {
        await chrome.storage.sync.set({ [USAGE_STATS_KEY]: false });
        queue.length = 0;
    }
}

async function installId(): Promise<string> {
    const got = await chrome.storage.local.get(CID_KEY);
    const cur = got?.[CID_KEY];
    if (typeof cur === 'string' && /^[0-9a-f-]{36}$/.test(cur)) return cur;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ [CID_KEY]: id });
    return id;
}

/** One number per browser session, so the reports can group events into visits. */
async function sessionId(): Promise<number> {
    const store = chrome.storage.session;
    const got = await store?.get(SID_KEY).catch(() => undefined);
    const cur = got?.[SID_KEY];
    if (typeof cur === 'number') return cur;
    const id = Math.floor(Date.now() / 1000);
    await store?.set({ [SID_KEY]: id }).catch(() => undefined);
    return id;
}

const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Record one event. Never throws and never blocks the feature that called it. */
export function track(name: string, params: Record<string, unknown> = {}): void {
    if (!NAME.test(name) || incognito() || typeof chrome === 'undefined' || !chrome.storage) return;
    queue.push({ n: name, p: safeParams(params), t: Date.now() });
    if (queue.length > MAX_BATCH * 3) queue.splice(0, queue.length - MAX_BATCH * 3);
    if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
}

/** Send what is queued, if the user has not turned statistics off. Failures are dropped. */
export async function flush(endpoint = ANALYTICS_ENDPOINT): Promise<void> {
    if (!queue.length) return;
    const batch = queue.splice(0, MAX_BATCH);
    try {
        if (!(await usageStatsEnabled())) { queue.length = 0; return; }
        const now = Date.now();
        const body = JSON.stringify({
            cid: await installId(),
            sid: await sessionId(),
            v: chrome.runtime.getManifest().version,
            // A development copy: the relay keeps its events out of the reports.
            ...(chrome.runtime.id !== STORE_EXTENSION_ID ? { dev: true } : {}),
            events: batch.map(e => ({ n: e.n, p: e.p, ago: Math.max(0, now - e.t) })),
        });
        await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    } catch {
        /* statistics are best effort */
    }
    if (queue.length) void flush(endpoint);
}

/** Message types from the extension's pages that count as using a feature (SW side). */
const MESSAGE_EVENTS: Record<string, string> = {
    CAPTURE_THUMBNAIL: 'preview_single',
    BATCH_CAPTURE: 'preview_batch',
    AUTO_TAG: 'auto_tag_run',
    AI_SEARCH: 'smart_search',
    CONNECTOR_ENABLE: 'connector_on',
    CONNECTOR_DISABLE: 'connector_off',
    BRIDGE_ENABLE: 'coding_agents_on',
    BRIDGE_DISABLE: 'coding_agents_off',
    CS_UNDO: 'ai_change_undo',
    CS_REDO: 'ai_change_redo',
    CS_APPLY: 'ai_change_approve',
    CS_REJECT: 'ai_change_discard',
    TRASH_DELETE: 'bookmark_delete',
    TRASH_RESTORE: 'trash_restore',
    TRASH_EMPTY: 'trash_empty',
    AGENT_TOOL: 'ask_ai_tool',
};

/** The event for one message to the service worker, or null. Exported for tests. */
export function eventForMessage(message: { type?: unknown; urls?: unknown; name?: unknown }): { name: string; params: EventParams } | null {
    const name = typeof message?.type === 'string' ? MESSAGE_EVENTS[message.type] : undefined;
    if (!name) return null;
    const params: Record<string, unknown> = {};
    if (message.type === 'BATCH_CAPTURE' && Array.isArray(message.urls)) params.count = bucket(message.urls.length);
    if (message.type === 'AGENT_TOOL' && typeof message.name === 'string') params.tool = message.name;
    return { name, params: safeParams(params) };
}
