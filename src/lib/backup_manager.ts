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
    async createBackup(): Promise<Blob> {
        // 1. Get Settings
        const settings = await chrome.storage.sync.get(null);

        // 2. Get Thumbnails Metadata
        const thumbnails = await db.getAllThumbnails();

        // Map to export format (exclude blob to save space, unless we want to support internal restore?)
        // User strategy: "Connect Folder" is primary backup for images.
        // So we export metadata.
        const exportThumbnails = thumbnails.map(t => ({
            id: t.id,
            url: t.url,
            filename: t.filename, // Export filename for re-linking
            title: '',
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
                // Restore metadata
                // We insert them into DB. 
                // IMPORTANT: We don't have the blob!
                // So we insert a record WITHOUT blob? Or with a placeholder?
                // If we insert without blob, the UI will try to load it and fail.
                // But this is "Sync & Restore".
                // The goal is: Import Metadata -> Connect Folder -> Extension matches Metadata to Files in Folder -> Updates DB with Blobs.

                // So we need a way to store "Pending" thumbnails?
                // Or we just store them as is (missing blob) and the "Connect Folder" logic handles the rest.
                // Let's store them. The UI checks `if (thumb && thumb.blob)`.
                // So if blob is missing, it won't show. That's fine.

                for (const t of data.thumbnails) {
                    // We check if it exists to avoid overwriting existing valid blobs
                    const existing = await db.getThumbnail(t.id);
                    if (!existing) {
                        await db.putThumbnail({
                            id: t.id,
                            url: t.url,
                            mime: 'image/webp', // Assumed
                            blob: null as any, // Placeholder
                            updatedAt: Date.now(),
                            width: 0,
                            height: 0,
                            sizeBytes: 0,
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
