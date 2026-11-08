// SPDX-License-Identifier: AGPL-3.0-only
import { thumbnailStorage } from './thumbnail_storage';
import { patchMetadata } from './metadata_client';
import type { ThumbnailStatus } from './storage_index';
import { PROVIDERS } from './ai_settings_storage';

export interface BackupData {
    version: number;
    /** 'settings' for a settings-only export; absent or 'full' for a full backup. */
    kind?: 'full' | 'settings';
    timestamp: number;
    settings: Record<string, unknown>;
    thumbnails?: Array<{
        id: string;
        url: string;
        filename?: string;
        title?: string;
        status?: ThumbnailStatus;
        image_data?: string; // Base64 image data
    }>;
}

export interface ImportResult {
    success: boolean;
    /** Thumbnails imported. */
    count: number;
    /** Settings applied. */
    settingsApplied: number;
    /** Settings present in the file but ignored (unknown key, wrong type, out of range). */
    settingsSkipped: number;
    /**
     * The file wanted to change the AI provider or endpoint while an API key is
     * saved. Not applied: the key must never be sent somewhere the user did not
     * enter it for. The user reviews it in AI Settings instead.
     */
    aiProviderHeld: boolean;
    kind: 'full' | 'settings';
}

/** Thrown when the file is not a backup from this extension. */
export class BackupFormatError extends Error {
    constructor(message = "That file isn't a backup from this extension.") {
        super(message);
        this.name = 'BackupFormatError';
    }
}

// Raw shape of a thumb_ record as stored in chrome.storage.local
interface RawThumbRecord {
    id: string;
    url: string;
    filename?: string;
    base64?: string;
}

const THUMB_PREFIX = 'thumb_';
const BACKUP_CHUNK_SIZE = 25;

// ─── Settings allowlist ───────────────────────────────────────────────────────
// One validated list shared by export and import. Each validator returns the
// normalised value, or undefined to drop it. Credentials (the API key and its
// encryption key live in chrome.storage.local) are never part of it.

type Validator = (v: unknown) => unknown;

const bool: Validator = v => (typeof v === 'boolean' ? v : undefined);
const oneOf = (values: readonly string[]): Validator => v => (typeof v === 'string' && values.includes(v) ? v : undefined);
const text = (max: number): Validator => v => (typeof v === 'string' && v.length <= max ? v.trim() : undefined);

/** http(s) endpoint without credentials or a query string; '' clears it. */
const endpoint: Validator = v => {
    if (typeof v !== 'string' || v.length > 500) return undefined;
    const raw = v.trim();
    if (raw === '') return '';
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
        if (u.username || u.password || u.search || u.hash) return undefined;
        return raw;
    } catch {
        return undefined;
    }
};

export const SETTINGS_SCHEMA: Readonly<Record<string, Validator>> = {
    useIncognito: bool,
    theme: oneOf(['light', 'dark', 'system']),
    // Same range the capture-delay input accepts.
    captureDelay: v => (typeof v === 'number' && Number.isFinite(v) && v >= 100 && v <= 30000 ? Math.round(v) : undefined),
    useActiveTabCapture: bool,
    sidebarHidden: bool,
    ai_mode: oneOf(['builtin', 'cloud']),
    ai_provider: oneOf(PROVIDERS.map(p => p.id)),
    ai_model: text(200),
    ai_custom_tags: text(2000),
    ai_custom_url: endpoint,
};

/** Changing either of these could redirect a saved API key; held when a key exists. */
const KEY_ROUTING_SETTINGS = ['ai_provider', 'ai_custom_url'] as const;

/** Keep only allowlisted settings with valid values. */
export function sanitizeSettings(raw: unknown): { settings: Record<string, unknown>; skipped: string[] } {
    const settings: Record<string, unknown> = {};
    const skipped: string[] = [];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { settings, skipped };
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const validate = Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key) ? SETTINGS_SCHEMA[key] : undefined;
        const clean = validate ? validate(value) : undefined;
        if (clean === undefined) skipped.push(key);
        else settings[key] = clean;
    }
    return { settings, skipped };
}

async function exportableSettings(): Promise<Record<string, unknown>> {
    const sync = await chrome.storage.sync.get(Object.keys(SETTINGS_SCHEMA));
    const present = Object.fromEntries(Object.entries(sync).filter(([, v]) => v !== undefined));
    return sanitizeSettings(present).settings;
}

function jsonBlob(data: unknown): Blob {
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export class BackupManager {
    /** Full backup: settings plus every cached preview. */
    async createBackup(): Promise<Blob> {
        const settings = await exportableSettings();

        // Read raw storage once for both thumbnails and metadata
        const allData = await chrome.storage.local.get(null);
        const thumbKeys = Object.keys(allData).filter(k => k.startsWith(THUMB_PREFIX));

        // Extract metadata from the same read instead of a second full-storage fetch
        const META_PREFIX = 'meta_';
        const allMeta: Record<string, { title?: string; status?: ThumbnailStatus }> = Object.fromEntries(
            Object.entries(allData)
                .filter(([k]) => k.startsWith(META_PREFIX))
                .map(([k, v]) => [k.slice(META_PREFIX.length), v as { title?: string; status?: ThumbnailStatus }])
        );

        const exportThumbnails: NonNullable<BackupData['thumbnails']> = [];

        for (let i = 0; i < thumbKeys.length; i += BACKUP_CHUNK_SIZE) {
            const chunk = thumbKeys.slice(i, i + BACKUP_CHUNK_SIZE);
            for (const key of chunk) {
                const r = allData[key] as RawThumbRecord;
                exportThumbnails.push({
                    id: r.id,
                    url: r.url,
                    filename: r.filename,
                    title: allMeta[r.id]?.title ?? '',
                    status: allMeta[r.id]?.status,
                    image_data: r.base64 || '',
                });
            }
            // Yield to event loop between chunks to keep UI responsive
            if (i + BACKUP_CHUNK_SIZE < thumbKeys.length) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
        }

        const backupData: BackupData = {
            version: 1,
            kind: 'full',
            timestamp: Date.now(),
            settings,
            thumbnails: exportThumbnails,
        };
        return jsonBlob(backupData);
    }

    /** Settings only: small, no previews read. Never contains an API key. */
    async createSettingsBackup(): Promise<Blob> {
        const backupData: BackupData = {
            version: 1,
            kind: 'settings',
            timestamp: Date.now(),
            settings: await exportableSettings(),
        };
        return jsonBlob(backupData);
    }

    async importBackup(file: File): Promise<ImportResult> {
        const text = await file.text();
        let data: BackupData;
        try {
            data = JSON.parse(text);
        } catch {
            throw new BackupFormatError();
        }
        if (typeof data !== 'object' || data === null || Array.isArray(data)
            || (!('settings' in data) && !('thumbnails' in data))) {
            throw new BackupFormatError();
        }
        if (typeof data.version === 'number' && data.version > 1) {
            throw new Error(`Unsupported backup version: ${data.version}. Please update the extension.`);
        }
        const kind: ImportResult['kind'] = data.kind === 'settings' ? 'settings' : 'full';

        const { settings, skipped } = sanitizeSettings(data.settings);
        let aiProviderHeld = false;
        const local = await chrome.storage.local.get('ai_api_key_encrypted');
        if (local.ai_api_key_encrypted) {
            const current = await chrome.storage.sync.get([...KEY_ROUTING_SETTINGS]);
            for (const key of KEY_ROUTING_SETTINGS) {
                if (!(key in settings)) continue;
                if ((current[key] ?? '') !== settings[key]) aiProviderHeld = true;
                delete settings[key];
            }
        }
        if (Object.keys(settings).length > 0) await chrome.storage.sync.set(settings);

        let count = 0;
        if (kind === 'full' && Array.isArray(data.thumbnails)) {
            for (const t of data.thumbnails) {
                // Validate untrusted input: a backup file is user-supplied and could
                // be malformed or hostile. `id` becomes a storage key, so it must be
                // a non-empty string; `url` likewise.
                if (!t || typeof t.id !== 'string' || !t.id || typeof t.url !== 'string') {
                    console.warn('Skipping invalid backup record', t);
                    continue;
                }

                // Only ever fetch inline data: URLs — never an arbitrary http(s) URL
                // embedded in the file (that would be an SSRF-style fetch from the
                // extension origin on import).
                let blob: Blob | null = null;
                if (typeof t.image_data === 'string' && t.image_data.startsWith('data:')) {
                    try {
                        const res = await fetch(t.image_data);
                        blob = await res.blob();
                    } catch (e) {
                        console.warn(`Failed to restore blob for ${t.id}`, e);
                    }
                }

                // Overwrite only when there is no record yet, or the existing one
                // has no image and the backup has one.
                const existing = await thumbnailStorage.getThumbnail(t.id);
                if (!existing || (!existing.blob && blob)) {
                    await thumbnailStorage.putThumbnail({
                        id: t.id,
                        url: t.url,
                        mime: blob ? blob.type : 'image/webp',
                        blob: blob || undefined,
                        updatedAt: Date.now(),
                        width: 0,
                        height: 0,
                        sizeBytes: blob ? blob.size : 0,
                        filename: t.filename
                    });
                    // Restore the metadata record too, otherwise imported
                    // thumbnails have no status and features that read the
                    // index (e.g. "Regenerate Failed") can't see them.
                    // Merge via the service worker's per-URL queue so AI tags
                    // already stored (or being written) for this URL survive.
                    await patchMetadata(t.id, {
                        url: t.url,
                        title: t.title || '',
                        status: t.status ?? (blob ? 'saved_indexeddb' : 'none'),
                        lastCaptureAt: Date.now(),
                    });
                    count++;
                }
            }
        }
        return {
            success: true,
            count,
            settingsApplied: Object.keys(settings).length,
            settingsSkipped: skipped.length,
            aiProviderHeld,
            kind,
        };
    }
}

export const backupManager = new BackupManager();
