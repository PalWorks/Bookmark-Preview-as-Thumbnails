import { thumbnailStorage } from './thumbnail_storage';

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

export class BackupManager {
    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async createBackup(): Promise<Blob> {
        // 1. Get Settings
        const settings = await chrome.storage.sync.get(null);

        // 2. Get Thumbnails Metadata
        const thumbnails = await thumbnailStorage.getAllThumbnails();

        // 3. Prepare export data
        // We now include the image data as Base64 to ensure full restoration
        const exportThumbnails = await Promise.all(thumbnails.map(async t => {
            let data = '';
            if (t.blob) {
                try {
                    data = await this.blobToBase64(t.blob);
                } catch (e) {
                    console.warn(`Failed to convert blob for ${t.id}`, e);
                }
            }
            return {
                id: t.id,
                url: t.url,
                filename: t.filename,
                title: '',
                image_data: data // Include Base64 image data
            };
        }));

        const backupData: BackupData = {
            version: 1,
            timestamp: Date.now(),
            settings,
            thumbnails: exportThumbnails
        };

        return new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    }

    async importBackup(file: File): Promise<{ success: boolean; count: number }> {
        try {
            const text = await file.text();
            const data: BackupData = JSON.parse(text);

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
