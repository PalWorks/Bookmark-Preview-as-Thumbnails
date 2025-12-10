export interface ThumbnailRecord {
    id: string;
    url: string;
    mime: string;
    blob: Blob;
    updatedAt: number;
    width: number;
    height: number;
    sizeBytes: number;
}

export interface HandleRecord {
    key: string; // e.g., 'default'
    handle: FileSystemDirectoryHandle;
    lastUsed: number;
}

const DB_NAME = 'bookmarks_thumbs';
const DB_VERSION = 1;
const STORE_THUMBNAILS = 'thumbnails';
const STORE_HANDLES = 'handles';

export class IndexedDBWrapper {
    private db: IDBDatabase | null = null;

    async open(): Promise<IDBDatabase> {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
                    db.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_HANDLES)) {
                    db.createObjectStore(STORE_HANDLES, { keyPath: 'key' });
                }
            };
        });
    }

    async putThumbnail(record: ThumbnailRecord): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_THUMBNAILS, 'readwrite');
            const store = tx.objectStore(STORE_THUMBNAILS);
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getThumbnail(id: string): Promise<ThumbnailRecord | undefined> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_THUMBNAILS, 'readonly');
            const store = tx.objectStore(STORE_THUMBNAILS);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteThumbnail(id: string): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_THUMBNAILS, 'readwrite');
            const store = tx.objectStore(STORE_THUMBNAILS);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async putHandle(record: HandleRecord): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_HANDLES, 'readwrite');
            const store = tx.objectStore(STORE_HANDLES);
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getHandle(key: string): Promise<HandleRecord | undefined> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_HANDLES, 'readonly');
            const store = tx.objectStore(STORE_HANDLES);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllThumbnails(): Promise<ThumbnailRecord[]> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_THUMBNAILS, 'readonly');
            const store = tx.objectStore(STORE_THUMBNAILS);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

export const db = new IndexedDBWrapper();
