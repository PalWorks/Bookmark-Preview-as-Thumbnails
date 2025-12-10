import { db } from './indexeddb';

export class FSAccess {
    private directoryHandle: FileSystemDirectoryHandle | null = null;

    async chooseDirectory(): Promise<void> {
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
        } catch (error: unknown) {
            if ((error as Error).name !== 'AbortError') {
                throw error;
            }
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
