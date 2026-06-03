import { useEffect, useState } from 'react';
import { storageIndex } from '../../lib/storage_index';
import type { AIAvailability } from '../../lib/ai_tagger';

export interface TaggingProgress {
    done: number;
    total: number;
}

export function useAITagger(currentFolder: chrome.bookmarks.BookmarkTreeNode | null, settingsVersion = 0) {
    const [aiAvailability, setAIAvailability] = useState<AIAvailability | 'checking'>('checking');
    const [isTagging, setIsTagging] = useState(false);
    const [taggingProgress, setTaggingProgress] = useState<TaggingProgress>({ done: 0, total: 0 });
    const [tags, setTags] = useState<Record<string, string[]>>({});

    // Re-check AI availability on mount and whenever settings are saved (settingsVersion bumps)
    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            setAIAvailability('checking');
            const res = await chrome.runtime.sendMessage({ type: 'CHECK_AI_AVAILABILITY' })
                .catch(() => ({ available: 'unsupported' as AIAvailability }));
            if (!cancelled) {
                setAIAvailability((res as { available: AIAvailability })?.available ?? 'unsupported');
            }
        };
        void check();
        return () => { cancelled = true; };
    }, [settingsVersion]);

    // Load persisted tags from storageIndex whenever the folder changes
    useEffect(() => {
        if (!currentFolder?.children) return;
        let cancelled = false;
        const load = async () => {
            const allMeta = await storageIndex.getAll();
            if (cancelled) return;
            const loaded: Record<string, string[]> = {};
            for (const node of currentFolder.children!) {
                if (node.url && allMeta[node.url]?.tags?.length) {
                    loaded[node.url] = allMeta[node.url].tags!;
                }
            }
            setTags(loaded);
        };
        void load();
        return () => { cancelled = true; };
    }, [currentFolder]);

    // Listen for SW broadcast messages about tagging progress
    useEffect(() => {
        const listener = (message: {
            type: string;
            url?: string;
            tags?: string[];
            total?: number;
            count?: number;
            error?: string;
        }) => {
            if (message.type === 'TAG_BATCH_STARTED') {
                setIsTagging(true);
                setTaggingProgress({ done: 0, total: message.total ?? 0 });
            } else if (message.type === 'TAG_UPDATED' && message.url && message.tags) {
                setTags(prev => ({ ...prev, [message.url!]: message.tags! }));
                setTaggingProgress(prev => ({ ...prev, done: prev.done + 1 }));
            } else if (message.type === 'TAG_EDITED' && message.url && message.tags) {
                // Manual edit from the Auto-Tag table — sync tags WITHOUT touching
                // batch progress (this isn't part of a running batch).
                setTags(prev => ({ ...prev, [message.url!]: message.tags! }));
            } else if (message.type === 'TAG_FAILED') {
                // Advance progress so a run with some failures still completes the bar
                setTaggingProgress(prev => ({ ...prev, done: prev.done + 1 }));
            } else if (
                message.type === 'TAG_BATCH_DONE' ||
                message.type === 'TAG_BATCH_FAILED'
            ) {
                setIsTagging(false);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    const triggerAutoTag = (bookmarks: Array<{ url: string; title: string }>) => {
        chrome.runtime.sendMessage({ type: 'AUTO_TAG', bookmarks })
            .catch((err: unknown) => console.error('[useAITagger] Failed to send AUTO_TAG', err));
    };

    const stopAutoTag = () => {
        chrome.runtime.sendMessage({ type: 'STOP_TAG' }).catch(() => { });
    };

    return { aiAvailability, isTagging, taggingProgress, tags, triggerAutoTag, stopAutoTag };
}
