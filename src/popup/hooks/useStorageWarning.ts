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

    const checkStorage = async () => {
        const { usage, quota, percentage } = await storageManager.getEstimate();
        if (percentage > 0.95) {
            setStorageWarning({
                level: 'critical',
                message:
                    `Critical Storage: ${storageManager.formatBytes(usage)} / ${storageManager.formatBytes(quota)} used. ` +
                    `Captures paused. Please connect a folder to save space.`,
            });
        } else if (percentage > 0.8) {
            setStorageWarning({
                level: 'warning',
                message:
                    `Low Storage: ${storageManager.formatBytes(usage)} / ${storageManager.formatBytes(quota)} used. ` +
                    `Consider connecting a folder.`,
            });
        } else {
            setStorageWarning({ level: 'none', message: '' });
        }
    };

    // Check on mount and every minute
    useEffect(() => {
        checkStorage();
        const interval = setInterval(checkStorage, 60_000);
        return () => clearInterval(interval);
    }, []);

    // Check again whenever a capture batch finishes
    useEffect(() => {
        if (!isCapturing) checkStorage();
    }, [isCapturing]);

    return storageWarning;
}
