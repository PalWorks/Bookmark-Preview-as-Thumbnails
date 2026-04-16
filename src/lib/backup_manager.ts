import { thumbnailStorage } from './thumbnail_storage';
import { storageIndex } from './storage_index';

export interface BackupData {
    version: number;
    timestamp: number;
    settings: Record<string, any>;
    thumbnails: Array<{
        id: string;
        url: string;
        filename?: string;
        title?: string;
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

        // Read raw storage once — avoids the getAllThumbnails base64↔blob round-trip
        const allData = await chrome.storage.local.get(null);
        const thumbKeys = Object.keys(allData).filter(k => k.startsWith(THUMB_PREFIX));

        // Fetch metadata so we can populate title in the export
        const allMeta = await storageIndex.getAll();

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

            if (typeof data.version !== 'number' || data.version !== 1) {
                throw new Error(`Unsupported or missing backup version: ${data.version ?? 'none'}`);
            }

            if (data.settings) {
                await chrome.storage.sync.set(data.settings);
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
