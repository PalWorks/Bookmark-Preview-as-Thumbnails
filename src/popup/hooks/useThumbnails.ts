import { useEffect, useRef, useState } from 'react';
import { thumbnailStorage } from '../../lib/thumbnail_storage';

export function useThumbnails(
    currentFolder: chrome.bookmarks.BookmarkTreeNode | null,
    useActiveTabCapture: boolean
) {
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set());
    const [queuedUrls, setQueuedUrls] = useState<Set<string>>(new Set());

    // Refs to access live state inside stale-closure-prone effects
    const thumbnailsRef = useRef<Record<string, string>>({});
    const loadingUrlsRef = useRef<Set<string>>(new Set());
    const queuedUrlsRef = useRef<Set<string>>(new Set());
    // Ref so auto-capture always uses the current setting even when currentFolder hasn't changed
    const useActiveTabCaptureRef = useRef(useActiveTabCapture);

    // Per-URL sequence guard: a burst of THUMBNAIL_UPDATED for one URL fires
    // parallel getThumbnail reads; only the latest read may apply, otherwise an
    // older read can resolve last and clobber newer image data.
    const updateSeqRef = useRef<Map<string, number>>(new Map());

    useEffect(() => { thumbnailsRef.current = thumbnails; }, [thumbnails]);
    useEffect(() => { loadingUrlsRef.current = loadingUrls; }, [loadingUrls]);
    useEffect(() => { queuedUrlsRef.current = queuedUrls; }, [queuedUrls]);
    useEffect(() => { useActiveTabCaptureRef.current = useActiveTabCapture; }, [useActiveTabCapture]);

    // Revoke all object URLs on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            Object.values(thumbnailsRef.current).forEach(url => URL.revokeObjectURL(url));
        };
    }, []);

    // Internal trigger: adds URLs to queued set and sends message to SW (no storage check)
    const triggerCapture = (urls: string[]) => {
        setQueuedUrls(prev => {
            const next = new Set(prev);
            urls.forEach(url => next.add(url));
            return next;
        });

        // Remove just-queued URLs again if the SW never takes ownership of them.
        // Without this they stay stuck in "Waiting…" forever (no CAPTURE_STARTED/
        // THUMBNAIL_UPDATED/BATCH_STOPPED will ever arrive for them).
        const releaseQueued = () => setQueuedUrls(prev => {
            const s = new Set(prev);
            urls.forEach(url => s.delete(url));
            return s;
        });

        chrome.runtime.sendMessage({
            type: 'BATCH_CAPTURE',
            urls,
            useActiveTabCapture: useActiveTabCaptureRef.current,
        })
            .then((response?: { status?: string }) => {
                // SW is already running a batch and rejected this one — don't leave
                // the URLs hanging in the queued set.
                if (response?.status === 'busy') {
                    console.warn('Capture already in progress; re-entrant batch was dropped.');
                    releaseQueued();
                }
            })
            .catch((err: unknown) => {
                // Message never reached the SW (asleep/unavailable). No broadcasts
                // will arrive, so release the queued URLs to avoid a stuck UI.
                console.error('Failed to send batch capture request', err);
                releaseQueued();
            });
    };

    // Listen for SW broadcast messages about capture state
    useEffect(() => {
        const listener = (message: { type: string; url?: string }) => {
            if (message.type === 'CAPTURE_STARTED' && message.url) {
                setQueuedUrls(prev => { const s = new Set(prev); s.delete(message.url!); return s; });
                setLoadingUrls(prev => { const s = new Set(prev); s.add(message.url!); return s; });
            } else if (message.type === 'THUMBNAIL_UPDATED' && message.url) {
                const url = message.url;
                const seq = (updateSeqRef.current.get(url) ?? 0) + 1;
                updateSeqRef.current.set(url, seq);
                thumbnailStorage.getThumbnail(url).then(thumb => {
                    // Ignore if a newer THUMBNAIL_UPDATED for this URL has since fired.
                    if (updateSeqRef.current.get(url) !== seq) return;
                    if (thumb?.blob) {
                        setThumbnails(prev => {
                            const old = prev[url];
                            if (old) URL.revokeObjectURL(old);
                            return { ...prev, [url]: URL.createObjectURL(thumb.blob!) };
                        });
                        setLoadingUrls(prev => { const s = new Set(prev); s.delete(url); return s; });
                    }
                });
            } else if (message.type === 'CAPTURE_FAILED' && message.url) {
                // Clear from BOTH sets: URLs skipped by the SW (e.g. unsupported
                // schemes) emit CAPTURE_FAILED without ever passing through
                // CAPTURE_STARTED, so they are still in queuedUrls, not loadingUrls.
                setQueuedUrls(prev => { const s = new Set(prev); s.delete(message.url!); return s; });
                setLoadingUrls(prev => { const s = new Set(prev); s.delete(message.url!); return s; });
            } else if (message.type === 'BATCH_STOPPED') {
                setLoadingUrls(new Set());
                setQueuedUrls(new Set());
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // Load existing thumbnails from storage when the current folder changes.
    // chrome.storage reads aren't abortable, so a folder switch (or unmount) can't
    // cancel an in-flight read — instead the `cancelled` flag makes a superseded
    // load discard its results at apply time, before any object URL is created.
    useEffect(() => {
        let cancelled = false;

        const loadThumbnails = async () => {
            if (!currentFolder?.children) return;

            const bookmarkNodes = currentFolder.children.filter(n => n.url);
            const thumbResults = await Promise.all(
                bookmarkNodes.map(async (node) => {
                    // Isolate per-thumbnail failures: one corrupt/unreadable record
                    // must not reject the whole folder load and blank every preview.
                    try {
                        return { url: node.url!, thumb: await thumbnailStorage.getThumbnail(node.url!) };
                    } catch (err) {
                        console.warn('Failed to load thumbnail for', node.url, err);
                        return { url: node.url!, thumb: undefined };
                    }
                })
            );

            // A newer load started (or we unmounted) while awaiting storage —
            // drop these results before creating any object URLs to avoid leaks.
            if (cancelled) return;

            const newThumbs: Record<string, string> = {};
            for (const { url, thumb } of thumbResults) {
                if (thumb?.blob) {
                    newThumbs[url] = URL.createObjectURL(thumb.blob);
                }
            }

            setThumbnails(prev => {
                for (const url of Object.keys(newThumbs)) {
                    if (prev[url]) URL.revokeObjectURL(prev[url]);
                }
                return { ...prev, ...newThumbs };
            });
        };

        loadThumbnails();
        return () => { cancelled = true; };
    }, [currentFolder]);

    const stopCapture = () => {
        chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => { });
    };

    return { thumbnails, loadingUrls, queuedUrls, triggerCapture, stopCapture };
}
