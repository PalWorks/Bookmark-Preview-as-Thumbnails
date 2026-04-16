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
    private readonly PREFIX = 'meta_';

    private key(id: string): string {
        return `${this.PREFIX}${id}`;
    }

    async get(id: string): Promise<MetadataRecord | undefined> {
        const result = await chrome.storage.local.get(this.key(id));
        return result[this.key(id)] as MetadataRecord | undefined;
    }

    async getAll(): Promise<Record<string, MetadataRecord>> {
        const all = await chrome.storage.local.get(null);
        // Return only meta_-prefixed keys, stripping the prefix from the returned map's keys
        return Object.fromEntries(
            Object.entries(all)
                .filter(([k]) => k.startsWith(this.PREFIX))
                .map(([k, v]) => [k.slice(this.PREFIX.length), v])
        ) as Record<string, MetadataRecord>;
    }

    async set(record: MetadataRecord): Promise<void> {
        await chrome.storage.local.set({ [this.key(record.id)]: record });
    }

    async remove(id: string): Promise<void> {
        await chrome.storage.local.remove(this.key(id));
    }

    async clear(): Promise<void> {
        await chrome.storage.local.clear();
    }
}

export const storageIndex = new StorageIndex();
