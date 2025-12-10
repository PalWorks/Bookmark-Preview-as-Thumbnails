export interface StorageEstimateResult {
    usage: number;
    quota: number;
    percentage: number;
}

export class StorageManager {
    private readonly WARNING_THRESHOLD = 0.8; // 80%
    private readonly CRITICAL_THRESHOLD = 0.95; // 95%

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

    async isLow(): Promise<boolean> {
        const { percentage } = await this.getEstimate();
        return percentage > this.WARNING_THRESHOLD;
    }

    async isCritical(): Promise<boolean> {
        const { percentage } = await this.getEstimate();
        return percentage > this.CRITICAL_THRESHOLD;
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
