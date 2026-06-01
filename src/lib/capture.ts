export interface CaptureResult {
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
    sizeBytes: number;
}

export class CaptureManager {
    // Mutex: serializes the activate+captureVisibleTab fallback so that
    // concurrent workers (CONCURRENCY=5) don't race to activate their tabs.
    private _fallbackLock: Promise<void> = Promise.resolve();

    async capture(tabId: number, options?: { useActiveTabCapture?: boolean; renderDelay?: number }): Promise<string> {
        try {
            const tab = await chrome.tabs.get(tabId);

            // Check if window is minimized
            let isMinimized = false;
            if (tab.windowId) {
                try {
                    const win = await chrome.windows.get(tab.windowId);
                    isMinimized = win.state === 'minimized';
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

                    // 3. Wait for render
                    await new Promise(resolve => setTimeout(resolve, options?.renderDelay || 300));

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

            // Try captureVisibleTab when the tab is active and not minimized.
            // The windowId parameter allows capture on unfocused windows from the SW.
            if (tab.active && !isMinimized) {
                try {
                    return await this.captureVisibleTab(tab.windowId);
                } catch (e) {
                    console.warn('Visible capture failed, falling back to background capture', e);
                }
            }
            try {
                return await this.captureBackgroundTab(tabId);
            } catch (bgError) {
                console.warn('Background capture failed, attempting visible tab fallback', bgError);
                // Fallback: activate the tab and use Chrome's native captureVisibleTab.
                // This bypasses content script injection (CSP safe) and html2canvas entirely.
                // Serialized through _fallbackLock to prevent concurrent tab activation.
                if (tab.windowId) {
                    return await this.serializedVisibleCapture(tabId, tab.windowId, options?.renderDelay);
                }
                throw bgError;
            }
        } catch (error) {
            console.error('Capture failed:', error);
            throw error;
        }
    }

    // Serialized fallback: only one worker activates a tab and captures at a time.
    // Prevents CONCURRENCY=5 workers from racing to change the active tab.
    // Focuses the window briefly so Chrome's compositor renders the content
    // (required on Linux where unfocused windows don't get composited).
    private async serializedVisibleCapture(tabId: number, windowId: number, renderDelay?: number): Promise<string> {
        let releaseLock: () => void;
        const waiting = this._fallbackLock;
        this._fallbackLock = new Promise<void>(r => { releaseLock = r; });

        await waiting;

        try {
            await chrome.windows.update(windowId, { focused: true });
            await chrome.tabs.update(tabId, { active: true });
            await new Promise(resolve => setTimeout(resolve, renderDelay || 300));
            const dataUrl = await this.captureVisibleTab(windowId);
            // Unfocus the capture window to return focus to the user's window
            await chrome.windows.update(windowId, { focused: false }).catch(() => { });
            return dataUrl;
        } finally {
            releaseLock!();
        }
    }

    private timeout(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Capture timed out after ${ms}ms`)), ms);
        });
    }

    async captureVisibleTab(windowId?: number): Promise<string> {
        const capturePromise = new Promise<string>((resolve, reject) => {
            const callback = (dataUrl: string) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(dataUrl);
                }
            };
            const options = { format: 'jpeg' as const, quality: 80 };
            // When windowId is undefined, Chrome captures the current window
            if (windowId !== undefined) {
                chrome.tabs.captureVisibleTab(windowId, options, callback);
            } else {
                chrome.tabs.captureVisibleTab(options, callback);
            }
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
                    return reject(new Error(chrome.runtime.lastError.message));
                }

                chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_TAB' }, (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
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
        bitmap.close();

        const compressedBlob = await canvas.convertToBlob({
            type: 'image/webp',
            quality,
        });

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
