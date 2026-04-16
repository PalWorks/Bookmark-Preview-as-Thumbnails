/// <reference types="chrome" />
import 'fake-indexeddb/auto';
import { vi, beforeEach } from 'vitest';

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
};

const sync = {
    get: vi.fn(),
    set: vi.fn(),
};

(globalThis as any).chrome = {
    storage: { local, sync },
    runtime: { lastError: undefined },
    tabs: {
        captureVisibleTab: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        query: vi.fn(),
        sendMessage: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: { get: vi.fn() },
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
});
