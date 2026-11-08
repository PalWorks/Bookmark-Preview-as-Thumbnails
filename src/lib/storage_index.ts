// SPDX-License-Identifier: AGPL-3.0-only
export type ThumbnailStatus = 'none' | 'pending' | 'saved_indexeddb' | 'saved_disk' | 'error';

export interface MetadataRecord {
    id: string;
    url: string;
    title: string;
    status: ThumbnailStatus;
    lastCaptureAt?: number;
    error?: string;
    tags?: string[];
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

    // Per-id write queue: patch() is read-merge-write, so two patches for the same
    // URL in this context must not interleave or one would drop the other's fields.
    private queues = new Map<string, Promise<unknown>>();

    /**
     * Merge `update` into the stored record (creating it if missing) without
     * dropping fields the caller did not mention, such as AI `tags` when a
     * preview is recaptured. Writes for the same id are serialised.
     */
    patch(
        id: string,
        update: Partial<Omit<MetadataRecord, 'id'>>,
        defaultsIfNew: Partial<Omit<MetadataRecord, 'id'>> = {},
    ): Promise<MetadataRecord> {
        const previous = this.queues.get(id) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                const existing = await this.get(id);
                const merged: MetadataRecord = {
                    id,
                    url: id,
                    title: '',
                    status: 'none',
                    ...(existing ?? defaultsIfNew),
                    ...update,
                };
                await this.set(merged);
                return merged;
            });
        this.queues.set(id, next);
        void next.finally(() => {
            if (this.queues.get(id) === next) this.queues.delete(id);
        }).catch(() => undefined);
        return next;
    }

    async remove(id: string): Promise<void> {
        await chrome.storage.local.remove(this.key(id));
    }

    async clear(): Promise<void> {
        const all = await chrome.storage.local.get(null);
        const metaKeys = Object.keys(all).filter(k => k.startsWith(this.PREFIX));
        if (metaKeys.length > 0) {
            await chrome.storage.local.remove(metaKeys);
        }
    }
}

export const storageIndex = new StorageIndex();
