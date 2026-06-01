import { thumbnailStorage } from './thumbnail_storage';
import { storageIndex } from './storage_index';
import type { ThumbnailStatus } from './storage_index';

export interface BackupData {
    version: number;
    timestamp: number;
    settings: Record<string, unknown>;
    thumbnails: Array<{
        id: string;
        url: string;
        filename?: string;
        title?: string;
        status?: ThumbnailStatus;
        image_data?: string; // Base64 image data
    }>;
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

export class BackupManager {
    async createBackup(): Promise<Blob> {
        const settings = await chrome.storage.sync.get(null);

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

        const exportThumbnails: BackupData['thumbnails'] = [];

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
            timestamp: Date.now(),
            settings,
            thumbnails: exportThumbnails,
        };

        return new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    }

    async importBackup(file: File): Promise<{ success: boolean; count: number }> {
        try {
            const text = await file.text();
            const data: BackupData = JSON.parse(text);

            if (typeof data.version === 'number' && data.version > 1) {
                throw new Error(`Unsupported backup version: ${data.version}. Please update the extension.`);
            }

            const ALLOWED_SYNC_KEYS = ['useIncognito', 'theme', 'captureDelay', 'useActiveTabCapture'] as const;
            if (data.settings) {
                const filtered: Record<string, unknown> = {};
                for (const key of ALLOWED_SYNC_KEYS) {
                    if (key in data.settings) {
                        filtered[key] = data.settings[key];
                    }
                }
                if (Object.keys(filtered).length > 0) {
                    await chrome.storage.sync.set(filtered);
                }
            }

            let count = 0;
            if (data.thumbnails && Array.isArray(data.thumbnails)) {
                for (const t of data.thumbnails) {
                    // Check if we have image data to restore
                    let blob: Blob | null = null;
                    if (t.image_data) {
                        try {
                            const res = await fetch(t.image_data);
                            blob = await res.blob();
                        } catch (e) {
                            console.warn(`Failed to restore blob for ${t.id}`, e);
                        }
                    }

                    // If we have a blob, we can fully restore.
                    // If not, we restore metadata and hope for "Connect Folder" linking.

                    // Check existing to avoid overwriting if we don't have better data
                    const existing = await thumbnailStorage.getThumbnail(t.id);

                    // We overwrite if:
                    // 1. No existing record
                    // 2. Existing record has no blob, but we have one
                    // 3. We are forcing a restore (usually yes for import)

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
                        await storageIndex.set({
                            id: t.id,
                            url: t.url,
                            title: t.title || '',
                            status: t.status ?? (blob ? 'saved_indexeddb' : 'none'),
                            lastCaptureAt: Date.now(),
                        });
                        count++;
                    }
                }
            }
            return { success: true, count };
        } catch (e) {
            console.error('Import failed', e);
            throw e;
        }
    }
}

export const backupManager = new BackupManager();
