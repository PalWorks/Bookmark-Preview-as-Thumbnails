export interface StorageEstimateResult {
    usage: number;
    quota: number;
    percentage: number;
}

export class StorageManager {
    async getEstimate(): Promise<StorageEstimateResult> {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const usage = estimate.usage || 0;
            const quota = estimate.quota || 1; // Avoid division by zero
            return {
                usage,
                quota,
                percentage: usage / quota
            };
        }
        return { usage: 0, quota: 0, percentage: 0 };
    }

    formatBytes(bytes: number, decimals = 2): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
}

export const storageManager = new StorageManager();
