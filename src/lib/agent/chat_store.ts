// SPDX-License-Identifier: AGPL-3.0-only
//
// Ask AI conversations, kept on this device (D24): an index of chats plus one record per
// chat in chrome.storage.local. Never synced and never in backups (backups pick thumb_,
// meta_ and allowlisted settings only). At most MAX_CHATS chats; the oldest goes first.
// The open chat's id lives in this tab's sessionStorage, so a reload continues it and two
// tabs never write the same chat over each other.

export const CHAT_INDEX_KEY = 'ask_ai_chats';
export const CHAT_PREFIX = 'ask_ai_chat_';
export const CURRENT_CHAT_KEY = 'ask_ai_current';
/** The 1.7.0 session-only conversation, moved into the history once. */
export const LEGACY_SESSION_KEY = 'ask_ai_chat';
export const MAX_CHATS = 50;

export interface ChatSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

export interface ChatRecord<I = unknown, M = unknown> {
    items: I[];
    history: M[];
}

const isSummary = (v: unknown): v is ChatSummary => {
    const s = v as ChatSummary;
    return !!s && typeof s.id === 'string' && /^[a-z0-9]{6,40}$/.test(s.id) && typeof s.title === 'string'
        && Number.isFinite(s.createdAt) && Number.isFinite(s.updatedAt);
};

export function newChatId(now = Date.now(), rand = Math.random): string {
    return `${now.toString(36)}${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/** The first line of the first message, short enough for a list row. */
export function chatTitle(firstMessage: string): string {
    const line = firstMessage.replace(/\s+/g, ' ').trim();
    if (!line) return 'New chat';
    return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/** Newest first. Unreadable rows are dropped rather than failing the list. */
export async function listChats(): Promise<ChatSummary[]> {
    const got = await chrome.storage.local.get(CHAT_INDEX_KEY);
    const raw = got?.[CHAT_INDEX_KEY];
    const list = Array.isArray(raw) ? raw.filter(isSummary) : [];
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadChat<I, M>(id: string): Promise<ChatRecord<I, M> | null> {
    const got = await chrome.storage.local.get(CHAT_PREFIX + id);
    const rec = got?.[CHAT_PREFIX + id] as ChatRecord<I, M> | undefined;
    if (!rec || !Array.isArray(rec.items)) return null;
    return { items: rec.items, history: Array.isArray(rec.history) ? rec.history : [] };
}

/**
 * Save one chat and its index row in one write, then drop chats beyond MAX_CHATS
 * (least recently used first). Returns the new index, newest first.
 */
export async function saveChat<I, M>(summary: ChatSummary, record: ChatRecord<I, M>): Promise<ChatSummary[]> {
    const others = (await listChats()).filter(c => c.id !== summary.id);
    const all = [summary, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
    const keep = all.slice(0, MAX_CHATS);
    const dropped = all.slice(MAX_CHATS).map(c => CHAT_PREFIX + c.id);
    await chrome.storage.local.set({ [CHAT_INDEX_KEY]: keep, [CHAT_PREFIX + summary.id]: record });
    if (dropped.length) await chrome.storage.local.remove(dropped);
    return keep;
}

export async function deleteChat(id: string): Promise<ChatSummary[]> {
    const keep = (await listChats()).filter(c => c.id !== id);
    await chrome.storage.local.set({ [CHAT_INDEX_KEY]: keep });
    await chrome.storage.local.remove(CHAT_PREFIX + id);
    return keep;
}

export async function deleteAllChats(): Promise<void> {
    const ids = (await listChats()).map(c => CHAT_PREFIX + c.id);
    await chrome.storage.local.remove([CHAT_INDEX_KEY, ...ids]);
    await setCurrentChatId(null);
}

const tabStore = (): Storage | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };

export async function getCurrentChatId(): Promise<string | null> {
    try { return tabStore()?.getItem(CURRENT_CHAT_KEY) ?? null; } catch { return null; }
}

export async function setCurrentChatId(id: string | null): Promise<void> {
    try {
        if (id) tabStore()?.setItem(CURRENT_CHAT_KEY, id);
        else tabStore()?.removeItem(CURRENT_CHAT_KEY);
    } catch { /* storage blocked: the chat simply starts fresh after a reload */ }
}

/** Day label for a list group or a divider: Today, Yesterday, the weekday this week, or the date. */
export function dayLabel(at: number, now = Date.now()): string {
    const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((day(now) - day(at)) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    // Like a phone chat: the weekday within the last week, then the date.
    if (diff > 1 && diff < 7) return new Date(at).toLocaleDateString(undefined, { weekday: 'long' });
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeLabel(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
