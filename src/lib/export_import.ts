import { thumbnailStorage } from './thumbnail_storage';
import { storageIndex } from './storage_index';
import type { MetadataRecord } from './storage_index';

interface ExportItem extends MetadataRecord {
    thumbnailBase64?: string;
    mime?: string;
}

export class ExportImportManager {
    async exportAllThumbnails(): Promise<void> {
        const metadata = await storageIndex.getAll();
        const thumbnails = await thumbnailStorage.getAllThumbnails();

        // For simplicity, we will just download each file individually for now,
        // or create a zip if we had a zip library.
        // Given the constraints, let's just download them as individual files.
        // Or better, create a JSON export with base64 images?
        // The requirement says "possibly zipped".
        // Let's implement a simple JSON export for metadata + images first, which is easier to import back.

        const exportData = {
            version: 1,
            timestamp: Date.now(),
            bookmarks: [] as ExportItem[],
        };

        for (const key in metadata) {
            const meta = metadata[key];
            const thumb = thumbnails.find(t => t.id === meta.id);

            if (thumb && thumb.blob) {
                const base64 = await this.blobToBase64(thumb.blob);
                exportData.bookmarks.push({
                    ...meta,
                    thumbnailBase64: base64,
                    mime: thumb.mime,
                });
            }
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        await chrome.downloads.download({
            url: url,
            filename: `bookmarks_thumbnails_export_${Date.now()}.json`,
            saveAs: true,
        });
    }

    async importData(file: File): Promise<void> {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.bookmarks || !Array.isArray(data.bookmarks)) {
            throw new Error('Invalid export file format');
        }

        for (const item of data.bookmarks) {
            if (item.thumbnailBase64) {
                const blob = await this.base64ToBlob(item.thumbnailBase64, item.mime);

                await thumbnailStorage.putThumbnail({
                    id: item.id,
                    url: item.url,
                    mime: item.mime,
                    blob: blob,
                    updatedAt: item.lastCaptureAt || Date.now(),
                    width: 600, // Default or store in export
                    height: 400, // Default
                    sizeBytes: blob.size,
                });

                await storageIndex.set({
                    id: item.id,
                    url: item.url,
                    title: item.title,
                    status: 'saved_indexeddb',
                    lastCaptureAt: item.lastCaptureAt,
                });
            }
        }
    }

    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                // Remove data URL prefix
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private async base64ToBlob(base64: string, mime: string): Promise<Blob> {
        const res = await fetch(`data:${mime};base64,${base64}`);
        return await res.blob();
    }
}

export const exportImportManager = new ExportImportManager();
