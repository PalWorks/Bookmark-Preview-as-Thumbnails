export interface CaptureResult {
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
    sizeBytes: number;
}

export class CaptureManager {
    async captureVisibleTab(windowId?: number): Promise<string> {
        return new Promise((resolve, reject) => {
            // @ts-expect-error - windowId can be undefined but type definition might be strict
            chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    // If capture fails, we could try to get og:image via content script
                    // For now, let's just reject, and the caller can handle fallback or retry.
                    // Or we can return a placeholder data URL.
                    console.warn('Capture failed, using fallback:', chrome.runtime.lastError.message);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(dataUrl);
                }
            });
        });
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
