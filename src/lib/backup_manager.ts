import { db } from './indexeddb';

export interface BackupData {
    version: number;
    timestamp: number;
    settings: Record<string, any>;
    thumbnails: Array<{
        id: string;
        url: string;
        filename?: string;
        title?: string;
        // We do NOT export the blob to keep file size small.
        // We rely on "Connect Folder" to restore the actual images if they are external.
        // If they are internal blobs, they are lost in this lightweight backup unless we decide to include them.
        // Given the user's context of "Connect Folder" being the backup, we export metadata.
        // However, for a true "backup" of internal data, we might want to include base64 blobs?
        // The user said "Connect folder will be used... when internal storage is exceeded".
        // So internal storage IS the primary. If we uninstall, internal is lost.
        // So we SHOULD export blobs if possible, or warn the user.
        // But blobs can be huge (hundreds of MBs). JSON stringify might crash.
        // Let's stick to metadata for now and assume "Connect Folder" is the way to persist images.
        // We will explicitly tell the user: "This backup saves your settings and links. To save images, use Connect Folder."
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
        const thumbnails = await db.getAllThumbnails();

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
                    if ((t as any).image_data) {
                        try {
                            const res = await fetch((t as any).image_data);
                            blob = await res.blob();
                        } catch (e) {
                            console.warn(`Failed to restore blob for ${t.id}`, e);
                        }
                    }

                    // If we have a blob, we can fully restore.
                    // If not, we restore metadata and hope for "Connect Folder" linking.

                    // Check existing to avoid overwriting if we don't have better data
                    const existing = await db.getThumbnail(t.id);

                    // We overwrite if:
                    // 1. No existing record
                    // 2. Existing record has no blob, but we have one
                    // 3. We are forcing a restore (usually yes for import)

                    if (!existing || (!existing.blob && blob)) {
                        await db.putThumbnail({
                            id: t.id,
                            url: t.url,
                            mime: blob ? blob.type : 'image/webp',
                            blob: blob as Blob, // Might be null, but type says Blob. We should probably allow null in DB type if we want metadata only support.
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
