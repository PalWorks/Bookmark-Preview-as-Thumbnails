import { useEffect, useState } from 'react';
import { storageManager } from '../../lib/storage_manager';

export interface StorageWarning {
    level: 'none' | 'warning' | 'critical';
    message: string;
}

export function useStorageWarning(isCapturing: boolean): StorageWarning {
    const [storageWarning, setStorageWarning] = useState<StorageWarning>({
        level: 'none',
        message: '',
    });

    const computeWarning = (usage: number, quota: number, percentage: number): StorageWarning => {
        if (percentage > 0.95) {
            return {
                level: 'critical',
                message:
                    `Critical Storage: ${storageManager.formatBytes(usage)} / ${storageManager.formatBytes(quota)} used. ` +
                    `Captures paused. Please connect a folder to save space.`,
            };
        }
        if (percentage > 0.8) {
            return {
                level: 'warning',
                message:
                    `Low Storage: ${storageManager.formatBytes(usage)} / ${storageManager.formatBytes(quota)} used. ` +
                    `Consider connecting a folder.`,
            };
        }
        return { level: 'none', message: '' };
    };

    // Poll storage usage (an external system) and push the result into state when
    // it resolves — the setState lives in an async callback, not the effect body.
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            const { usage, quota, percentage } = await storageManager.getEstimate();
            if (!cancelled) setStorageWarning(computeWarning(usage, quota, percentage));
        };
        void refresh();
        const interval = setInterval(() => { void refresh(); }, 60_000);
        return () => { cancelled = true; clearInterval(interval); };
    }, []);

    // Re-check when a capture batch finishes (usage may have jumped during it)
    useEffect(() => {
        if (isCapturing) return;
        let cancelled = false;
        (async () => {
            const { usage, quota, percentage } = await storageManager.getEstimate();
            if (!cancelled) setStorageWarning(computeWarning(usage, quota, percentage));
        })();
        return () => { cancelled = true; };
    }, [isCapturing]);

    return storageWarning;
}
