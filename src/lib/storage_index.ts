export type ThumbnailStatus = 'none' | 'pending' | 'saved_indexeddb' | 'saved_disk' | 'error';

export interface MetadataRecord {
    id: string;
    url: string;
    title: string;
    status: ThumbnailStatus;
    lastCaptureAt?: number;
    error?: string;
}

export class StorageIndex {
    async get(id: string): Promise<MetadataRecord | undefined> {
        const result = await chrome.storage.local.get(id);
        return result[id] as MetadataRecord | undefined;
    }

    async getAll(): Promise<Record<string, MetadataRecord>> {
        return await chrome.storage.local.get(null) as Record<string, MetadataRecord>;
    }

    async set(record: MetadataRecord): Promise<void> {
        await chrome.storage.local.set({ [record.id]: record });
    }

    async remove(id: string): Promise<void> {
        await chrome.storage.local.remove(id);
    }

    async clear(): Promise<void> {
        await chrome.storage.local.clear();
    }
}

export const storageIndex = new StorageIndex();
