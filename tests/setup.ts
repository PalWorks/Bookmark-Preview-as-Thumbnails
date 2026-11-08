// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="chrome" />
import 'fake-indexeddb/auto';
import { vi, beforeEach } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';

// ─── In-memory storage backing ────────────────────────────────────────────────

export const localStore: Record<string, unknown> = {};
export const syncStore: Record<string, unknown> = {};

// ─── Chrome mock ──────────────────────────────────────────────────────────────

// Storage functions are re-wired in wireStorageMocks() after each vi.resetAllMocks()
// so implementations are always live.

/* eslint-disable @typescript-eslint/no-explicit-any */
const local = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    getKeys: vi.fn(),
};

const sync = {
    get: vi.fn(),
    set: vi.fn(),
};

export const EXTENSION_ORIGIN = 'chrome-extension://testextensionid/';

// chrome.alarms fake: alarms live in a map; tests fire them with fireAlarm().
export const alarmStore = new Map<string, chrome.alarms.Alarm>();
const alarmListeners = new Set<(a: chrome.alarms.Alarm) => void>();
export function fireAlarm(name: string): void {
    const a = alarmStore.get(name);
    if (a) alarmListeners.forEach(l => l(a));
}
const alarms = {
    create: (name: string, info: { periodInMinutes?: number; delayInMinutes?: number }) => {
        alarmStore.set(name, { name, scheduledTime: Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000, periodInMinutes: info.periodInMinutes });
        return Promise.resolve();
    },
    get: (name: string) => Promise.resolve(alarmStore.get(name)),
    clear: (name: string) => Promise.resolve(alarmStore.delete(name)),
    onAlarm: {
        addListener: (fn: (a: chrome.alarms.Alarm) => void) => { alarmListeners.add(fn); },
        removeListener: (fn: (a: chrome.alarms.Alarm) => void) => { alarmListeners.delete(fn); },
    },
};

(globalThis as any).chrome = {
    storage: { local, sync, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    runtime: {
        id: 'testextensionid',
        lastError: undefined,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn().mockResolvedValue(undefined),
        getURL: (p: string) => `${EXTENSION_ORIGIN}${p.replace(/^\//, '')}`,
    },
    extension: { inIncognitoContext: false },
    bookmarks: fakeBookmarks.api(),
    alarms,
    tabs: {
        captureVisibleTab: vi.fn(),
        create: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        query: vi.fn(),
        sendMessage: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: { get: vi.fn(), create: vi.fn() },
    scripting: { executeScript: vi.fn() },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Blob.text() polyfill — jsdom 27 omits this WHATWG method ─────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
if (typeof (Blob.prototype as any).text !== 'function') {
    (Blob.prototype as any).text = function (): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(this as Blob);
        });
    };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Fetch mock — handles data: URLs used by ThumbnailStorage / BackupManager ──

/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('data:')) {
        const commaIdx = url.indexOf(',');
        const mime = url.slice(5, commaIdx).split(';')[0];
        const b64 = url.slice(commaIdx + 1);
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        return { ok: true, status: 200, blob: async () => blob } as unknown as Response;
    }
    throw new Error(`Unhandled fetch in test environment: ${url}`);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Storage implementation factory ──────────────────────────────────────────

function wireStorageMocks(): void {
    local.get.mockImplementation((keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return Promise.resolve({ ...localStore });
        if (typeof keys === 'string') return Promise.resolve({ [keys]: localStore[keys] });
        if (Array.isArray(keys)) {
            const r: Record<string, unknown> = {};
            (keys as string[]).forEach(k => { r[k] = localStore[k]; });
            return Promise.resolve(r);
        }
        return Promise.resolve({});
    });
    local.set.mockImplementation((items: Record<string, unknown>) => {
        Object.assign(localStore, items);
        return Promise.resolve();
    });
    local.remove.mockImplementation((keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach(k => delete localStore[k as string]);
        return Promise.resolve();
    });
    local.clear.mockImplementation(() => {
        Object.keys(localStore).forEach(k => delete localStore[k]);
        return Promise.resolve();
    });
    local.getKeys.mockImplementation(() => Promise.resolve(Object.keys(localStore)));

    sync.get.mockImplementation((keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return Promise.resolve({ ...syncStore });
        if (typeof keys === 'string') return Promise.resolve({ [keys]: syncStore[keys] });
        if (Array.isArray(keys)) {
            const r: Record<string, unknown> = {};
            (keys as string[]).forEach(k => { r[k] = syncStore[k]; });
            return Promise.resolve(r);
        }
        return Promise.resolve({});
    });
    sync.set.mockImplementation((items: Record<string, unknown>) => {
        Object.assign(syncStore, items);
        return Promise.resolve();
    });
}

// Wire on initial load
wireStorageMocks();

// ─── Per-test reset ────────────────────────────────────────────────────────────

beforeEach(() => {
    // Clear stored data
    Object.keys(localStore).forEach(k => delete localStore[k]);
    Object.keys(syncStore).forEach(k => delete syncStore[k]);
    // Reset all mock call histories AND implementations
    vi.resetAllMocks();
    // Re-wire storage implementations (cleared by resetAllMocks above)
    wireStorageMocks();
    // Fresh bookmark tree and alarms; restore runtime defaults tests may override.
    fakeBookmarks.reset({});
    alarmStore.clear();
    alarmListeners.clear();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (globalThis as any).chrome.bookmarks = fakeBookmarks.api();
    (globalThis as any).chrome.extension.inIncognitoContext = false;
    (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined);
    /* eslint-enable @typescript-eslint/no-explicit-any */
});
