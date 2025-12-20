export interface CaptureResult {
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
    sizeBytes: number;
}

export class CaptureManager {
    async capture(tabId: number, options?: { useActiveTabCapture?: boolean }): Promise<string> {
        try {
            const tab = await chrome.tabs.get(tabId);

            // Check if window is minimized or unfocused
            let isMinimized = false;
            let isFocused = false;
            if (tab.windowId) {
                try {
                    const win = await chrome.windows.get(tab.windowId);
                    isMinimized = win.state === 'minimized';
                    isFocused = !!win.focused;
                } catch (e) {
                    console.warn('Could not get window state', e);
                }
            }

            // If active capture is requested, force activation
            if (options?.useActiveTabCapture && tab.windowId) {
                try {
                    // 1. Get current active tab to restore later
                    const [currentActive] = await chrome.tabs.query({ windowId: tab.windowId, active: true });
                    const originalActiveId = currentActive?.id;

                    // 2. Activate target tab
                    await chrome.tabs.update(tabId, { active: true });

                    // 3. Wait for render (short delay)
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // 4. Capture
                    const dataUrl = await this.captureVisibleTab(tab.windowId);

                    // 5. Restore original tab (if different)
                    if (originalActiveId && originalActiveId !== tabId) {
                        await chrome.tabs.update(originalActiveId, { active: true });
                    }

                    return dataUrl;
                } catch (e) {
                    console.warn('Active capture failed, falling back to standard logic', e);
                    // Fallthrough to standard logic
                }
            }

            // Only use visible capture if active, not minimized, AND focused
            if (tab.active && !isMinimized && isFocused) {
                try {
                    return await this.captureVisibleTab(tab.windowId);
                } catch (e) {
                    console.warn('Visible capture failed, falling back to background capture', e);
                }
            }
            return await this.captureBackgroundTab(tabId);
        } catch (error) {
            console.error('Capture failed:', error);
            throw error;
        }
    }

    private timeout(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Capture timed out after ${ms}ms`)), ms);
        });
    }

    async captureVisibleTab(windowId?: number): Promise<string> {
        const capturePromise = new Promise<string>((resolve, reject) => {
            // @ts-expect-error - windowId can be undefined
            chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(dataUrl);
                }
            });
        });

        return Promise.race([capturePromise, this.timeout(5000)]);
    }

    async captureBackgroundTab(tabId: number): Promise<string> {
        const capturePromise = new Promise<string>((resolve, reject) => {
            chrome.scripting.executeScript({
                target: { tabId },
                files: ['content-script.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }

                chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_TAB' }, (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(chrome.runtime.lastError);
                    }
                    if (response && response.success) {
                        resolve(response.dataUrl);
                    } else {
                        reject(new Error(response?.error || 'Unknown capture error'));
                    }
                });
            });
        });

        return Promise.race([capturePromise, this.timeout(10000)]);
    }

    async resizeAndCompress(
        dataUrl: string,
        targetWidth: number,
        quality: number = 0.8
    ): Promise<CaptureResult> {
        // Check if OffscreenCanvas is available (Service Worker)
        if (typeof OffscreenCanvas !== 'undefined') {
            return this.resizeOffscreen(dataUrl, targetWidth, quality);
        } else {
            // Fallback for DOM context (Popup/Options)
            return this.resizeDOM(dataUrl, targetWidth, quality);
        }
    }

    private async resizeOffscreen(
        dataUrl: string,
        targetWidth: number,
        quality: number
    ): Promise<CaptureResult> {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const aspectRatio = bitmap.height / bitmap.width;
        const targetHeight = Math.round(targetWidth * aspectRatio);

        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');

        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

        const compressedBlob = await canvas.convertToBlob({
            type: 'image/webp',
            quality,
        });

        // Create a data URL for the blob (manual construction or FileReader)
        // FileReader is not available in SW in some versions, but we can use a simple reader if needed.
        // Actually, for the result, we might just want the blob.
        // But the interface asks for dataUrl.
        // In SW, we can use FileReader if available, or just return null dataUrl if not needed immediately.
        // However, FileReader IS available in Service Workers.
        const compressedDataUrl = await this.blobToDataURL(compressedBlob);

        return {
            blob: compressedBlob,
            dataUrl: compressedDataUrl,
            width: targetWidth,
            height: targetHeight,
            sizeBytes: compressedBlob.size,
        };
    }

    private async resizeDOM(
        dataUrl: string,
        targetWidth: number,
        quality: number
    ): Promise<CaptureResult> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const aspectRatio = img.height / img.width;
                const targetHeight = Math.round(targetWidth * aspectRatio);

                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Could not get 2d context'));
                    return;
                }

                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            reject(new Error('Canvas toBlob failed'));
                            return;
                        }
                        resolve({
                            blob,
                            dataUrl: canvas.toDataURL('image/webp', quality),
                            width: targetWidth,
                            height: targetHeight,
                            sizeBytes: blob.size,
                        });
                    },
                    'image/webp',
                    quality
                );
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    private blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}

export const captureManager = new CaptureManager();
