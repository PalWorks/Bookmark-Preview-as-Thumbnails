import { db } from './indexeddb';
import type { ThumbnailRecord } from './indexeddb';

interface StoredThumbnailRecord extends Omit<ThumbnailRecord, 'blob'> {
    base64?: string;
}

export class ThumbnailStorage {
    private readonly PREFIX = 'thumb_';

    private getKey(id: string): string {
        return `${this.PREFIX}${id}`;
    }

    private async blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private async base64ToBlob(base64: string): Promise<Blob> {
        const res = await fetch(base64);
        return await res.blob();
    }

    async putThumbnail(record: ThumbnailRecord): Promise<void> {
        let base64Blob: string | undefined;
        if (record.blob) {
            base64Blob = await this.blobToBase64(record.blob);
        }

        // Store everything except the raw blob, replace with base64 string
        const { blob: _blob, ...rest } = record;
        const storageRecord: StoredThumbnailRecord = {
            ...rest,
            base64: base64Blob
        };

        await chrome.storage.local.set({ [this.getKey(record.id)]: storageRecord });
    }

    async getThumbnail(id: string): Promise<ThumbnailRecord | undefined> {
        const key = this.getKey(id);
        const result = await chrome.storage.local.get(key);
        const record = result[key] as StoredThumbnailRecord | undefined;

        if (record) {
            // Found in shared storage
            if (record.base64) {
                const blob = await this.base64ToBlob(record.base64);
                const { base64: _base64, ...rest } = record;
                return {
                    ...rest,
                    blob
                } as ThumbnailRecord;
            }
            // Metadata only (no image data)
            const { base64: _base64, ...rest } = record;
            return {
                ...rest,
                blob: undefined // Explicitly undefined
            } as unknown as ThumbnailRecord; // Cast because ThumbnailRecord interface might require blob, but we handle it
        }

        // Not found in shared storage, check legacy IndexedDB (Lazy Migration)
        try {
            const legacyRecord = await db.getThumbnail(id);
            if (legacyRecord) {
                console.log(`Migrating thumbnail ${id} to shared storage`);
                // Migrate to shared storage
                await this.putThumbnail(legacyRecord);
                return legacyRecord;
            }
        } catch (_e) {
            console.warn('Failed to check legacy IndexedDB', _e);
        }

        return undefined;
    }

    async deleteThumbnail(id: string): Promise<void> {
        await chrome.storage.local.remove(this.getKey(id));
        // Also try to delete from legacy DB to be clean
        try {
            await db.deleteThumbnail(id);
        } catch (_e) {
            // Ignore
        }
    }

    async getAllThumbnails(): Promise<ThumbnailRecord[]> {
        // This is expensive with chrome.storage.local if we fetch everything.
        // But for now, let's implement it.
        const allData = await chrome.storage.local.get(null);
        const thumbnails: ThumbnailRecord[] = [];

        for (const [key, value] of Object.entries(allData)) {
            if (key.startsWith(this.PREFIX)) {
                const record = value as StoredThumbnailRecord;
                if (record.base64) {
                    const blob = await this.base64ToBlob(record.base64);
                    const { base64: _base64, ...rest } = record;
                    thumbnails.push({
                        ...rest,
                        blob
                    });
                } else {
                    // Metadata only
                    const { base64: _base64, ...rest } = record;
                    thumbnails.push({
                        ...rest,
                        blob: undefined
                    } as unknown as ThumbnailRecord);
                }
            }
        }

        return thumbnails;
    }
}

export const thumbnailStorage = new ThumbnailStorage();
