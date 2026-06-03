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

    async capture(tabId: number, options?: { useActiveTabCapture?: boolean; renderDelay?: number; signal?: AbortSignal }): Promise<string> {
        const signal = options?.signal;
        try {
            if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');
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

                    // 3. Wait for render (cancellable)
                    await this.delay(options?.renderDelay || 300, signal);

                    // 4. Capture
                    const dataUrl = await this.captureVisibleTab(tab.windowId, signal);

                    // 5. Restore original tab (if different)
                    if (originalActiveId && originalActiveId !== tabId) {
                        await chrome.tabs.update(originalActiveId, { active: true });
                    }

                    return dataUrl;
                } catch (e) {
                    if (signal?.aborted) throw e; // a stop must propagate, not fall through
                    console.warn('Active capture failed, falling back to standard logic', e);
                    // Fallthrough to standard logic
                }
            }

            // Try captureVisibleTab when the tab is active and not minimized.
            // The windowId parameter allows capture on unfocused windows from the SW.
            if (tab.active && !isMinimized) {
                try {
                    return await this.captureVisibleTab(tab.windowId, signal);
                } catch (e) {
                    if (signal?.aborted) throw e;
                    console.warn('Visible capture failed, falling back to background capture', e);
                }
            }
            try {
                return await this.captureBackgroundTab(tabId, signal);
            } catch (bgError) {
                if (signal?.aborted) throw bgError;
                console.warn('Background capture failed, attempting visible tab fallback', bgError);
                // Fallback: activate the tab and use Chrome's native captureVisibleTab.
                // This bypasses content script injection (CSP safe) and html2canvas entirely.
                // Serialized through _fallbackLock to prevent concurrent tab activation.
                if (tab.windowId) {
                    return await this.serializedVisibleCapture(tabId, tab.windowId, options?.renderDelay, signal);
                }
                throw bgError;
            }
        } catch (error) {
            console.error('Capture failed:', error);
            throw error;
        }
    }

    // Race a capture against the abort signal so Stop unwinds it immediately, and
    // ALWAYS detach the abort listener once settled — otherwise a long batch would
    // pile up one dangling listener per capture on the shared batch signal.
    private async raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
        if (!signal) return p;
        if (signal.aborted) throw new DOMException('Capture aborted', 'AbortError');
        let onAbort!: () => void;
        const abortP = new Promise<never>((_, reject) => {
            onAbort = () => reject(new DOMException('Capture aborted', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
            return await Promise.race([p, abortP]);
        } finally {
            signal.removeEventListener('abort', onAbort);
        }
    }

    // Cancellable sleep used for render-settle delays. Detaches its listener on both
    // paths (resolve and abort) so nothing lingers on the batch signal.
    private delay(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (signal?.aborted) { reject(new DOMException('Capture aborted', 'AbortError')); return; }
            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Capture aborted', 'AbortError'));
            };
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    // Serialized fallback: only one worker activates a tab and captures at a time.
    // Prevents CONCURRENCY=5 workers from racing to change the active tab.
    // Focuses the window briefly so Chrome's compositor renders the content
    // (required on Linux where unfocused windows don't get composited).
    private async serializedVisibleCapture(tabId: number, windowId: number, renderDelay?: number, signal?: AbortSignal): Promise<string> {
        let releaseLock: () => void;
        const waiting = this._fallbackLock;
        this._fallbackLock = new Promise<void>(r => { releaseLock = r; });

        await waiting;

        try {
            // A stop may have arrived while queued behind the lock — don't start work.
            if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');
            await chrome.windows.update(windowId, { focused: true });
            await chrome.tabs.update(tabId, { active: true });
            await this.delay(renderDelay || 300, signal);
            const dataUrl = await this.captureVisibleTab(windowId, signal);
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

    async captureVisibleTab(windowId?: number, signal?: AbortSignal): Promise<string> {
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

        return this.raceAbort(Promise.race([capturePromise, this.timeout(5000)]), signal);
    }

    async captureBackgroundTab(tabId: number, signal?: AbortSignal): Promise<string> {
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

        return this.raceAbort(Promise.race([capturePromise, this.timeout(10000)]), signal);
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
