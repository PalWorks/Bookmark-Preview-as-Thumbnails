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
        chrome.runtime.sendMessage({
            type: 'BATCH_CAPTURE',
            urls,
            useActiveTabCapture: useActiveTabCaptureRef.current,
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
                thumbnailStorage.getThumbnail(url).then(thumb => {
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
                setLoadingUrls(prev => { const s = new Set(prev); s.delete(message.url!); return s; });
            } else if (message.type === 'BATCH_STOPPED') {
                setLoadingUrls(new Set());
                setQueuedUrls(new Set());
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // Load thumbnails when the current folder changes; auto-capture any missing ones
    useEffect(() => {
        const loadThumbsAndCapture = async () => {
            if (!currentFolder?.children) return;

            const newThumbs: Record<string, string> = {};
            const existingUrls = new Set<string>();

            const bookmarkNodes = currentFolder.children.filter(n => n.url);
            const thumbResults = await Promise.all(
                bookmarkNodes.map(async (node) => ({
                    url: node.url!,
                    thumb: await thumbnailStorage.getThumbnail(node.url!),
                }))
            );
            for (const { url, thumb } of thumbResults) {
                if (thumb?.blob) {
                    newThumbs[url] = URL.createObjectURL(thumb.blob);
                    existingUrls.add(url);
                }
            }

            setThumbnails(prev => {
                // Revoke old object URLs being replaced to avoid leaks
                for (const url of Object.keys(newThumbs)) {
                    if (prev[url]) URL.revokeObjectURL(prev[url]);
                }
                return { ...prev, ...newThumbs };
            });

            const missingUrls = bookmarkNodes
                .map(n => n.url!)
                .filter(url =>
                    !existingUrls.has(url) &&
                    !loadingUrlsRef.current.has(url) &&
                    !queuedUrlsRef.current.has(url)
                );

            if (missingUrls.length > 0) {
                triggerCapture(missingUrls);
            }
        };

        loadThumbsAndCapture();
    }, [currentFolder]); // eslint-disable-line react-hooks/exhaustive-deps

    const stopCapture = () => {
        chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
    };

    return { thumbnails, loadingUrls, queuedUrls, triggerCapture, stopCapture };
}
