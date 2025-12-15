import { db } from './indexeddb';
import { thumbnailStorage } from './thumbnail_storage';

export class FSAccess {
    private directoryHandle: FileSystemDirectoryHandle | null = null;

    async chooseDirectory(): Promise<{ success: boolean; count: number }> {
        if (typeof window.showDirectoryPicker === 'undefined') {
            throw new Error('File System Access API not supported');
        }

        try {
            this.directoryHandle = await window.showDirectoryPicker({
                id: 'bookmarks-thumbnails',
                mode: 'readwrite',
            });

            // Persist handle to IndexedDB
            await db.putHandle({
                key: 'default',
                handle: this.directoryHandle,
                lastUsed: Date.now(),
            });

            // Scan and Re-link Logic
            let count = 0;
            const thumbnails = await thumbnailStorage.getAllThumbnails();
            const filenameMap = new Map<string, string>(); // filename -> id
            thumbnails.forEach(t => {
                if (t.filename) {
                    filenameMap.set(t.filename, t.id);
                }
            });

            if (filenameMap.size > 0) {
                // Iterate directory
                for await (const entry of this.directoryHandle.values()) {
                    if (entry.kind === 'file') {
                        const fileHandle = entry as FileSystemFileHandle;
                        if (filenameMap.has(fileHandle.name)) {
                            const id = filenameMap.get(fileHandle.name)!;
                            const thumb = await thumbnailStorage.getThumbnail(id);
                            if (thumb && !thumb.blob) {
                                const file = await fileHandle.getFile();
                                thumb.blob = file;
                                await thumbnailStorage.putThumbnail(thumb);
                                count++;
                            }
                        }
                    }
                }
            }

            return { success: true, count };

        } catch (error: unknown) {
            if ((error as Error).name === 'AbortError') {
                return { success: false, count: 0 };
            }
            throw error;
        }
    }

    async restoreHandle(): Promise<boolean> {
        const record = await db.getHandle('default');
        if (!record) return false;

        this.directoryHandle = record.handle;

        // Verify permission
        const permission = await this.verifyPermission(this.directoryHandle, true);
        return permission;
    }

    async verifyPermission(
        handle: FileSystemDirectoryHandle,
        readWrite: boolean
    ): Promise<boolean> {
        const options: FileSystemHandlePermissionDescriptor = {};
        if (readWrite) {
            options.mode = 'readwrite';
        }

        if ((await handle.queryPermission(options)) === 'granted') {
            return true;
        }

        if ((await handle.requestPermission(options)) === 'granted') {
            return true;
        }

        return false;
    }

    async writeFile(name: string, blob: Blob): Promise<void> {
        if (!this.directoryHandle) {
            throw new Error('No directory selected');
        }

        const fileHandle = await this.directoryHandle.getFileHandle(name, {
            create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
    }

    get isReady(): boolean {
        return this.directoryHandle !== null;
    }
}

export const fsAccess = new FSAccess();
