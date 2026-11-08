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
    /** The user's rating, 1 to 5 (absent: not rated). Keyed by URL like everything here. */
    rating?: number;
    /** Last time the link was opened from this extension (ms since epoch). */
    lastOpenedAt?: number;
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
        /** Fields to remove (for example a cleared rating). */
        remove: Array<keyof Omit<MetadataRecord, 'id' | 'url' | 'title' | 'status'>> = [],
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
                for (const k of remove) delete merged[k];
                await this.set(merged);
                return merged;
            });
        this.queues.set(id, next);
        void next.finally(() => {
            if (this.queues.get(id) === next) this.queues.delete(id);
        }).catch(() => undefined);
        return next;
    }

    /**
     * Read-modify-write through the same per-id queue as patch(): `fn` gets the
     * current record (or undefined) and returns the fields to merge, or undefined
     * to leave it alone. Used where the decision depends on the stored value.
     */
    update(
        id: string,
        fn: (existing: MetadataRecord | undefined) => Partial<Omit<MetadataRecord, 'id'>> | undefined,
    ): Promise<MetadataRecord | undefined> {
        const previous = this.queues.get(id) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                const existing = await this.get(id);
                const change = fn(existing);
                if (!change || Object.keys(change).length === 0) return existing;
                const merged: MetadataRecord = { id, url: id, title: '', status: 'none', ...(existing ?? {}), ...change };
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
