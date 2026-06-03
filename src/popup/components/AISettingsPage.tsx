import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Eye, EyeOff, CheckCircle2, Search, Copy, Trash2, ExternalLink, Sparkles, Plus, X, StopCircle, ChevronDown } from 'lucide-react';
import './AISettingsPage.css';
import {
    loadAISettings, saveAISettings, getDecryptedApiKey, saveCustomTags, parseCustomTags, PROVIDERS,
    type AIMode, type AIProvider,
} from '../../lib/ai_settings_storage';
import { AI_TAGS, validateProviderKey, SEARCH_CAP_BUILTIN, SEARCH_CAP_CLOUD, type AIAvailability } from '../../lib/ai_tagger';
import { storageIndex } from '../../lib/storage_index';

type KeepPolicy = 'oldest' | 'newest';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AISettingsPageProps {
    onSave: () => void;
    onBack: () => void;
    currentFolder: chrome.bookmarks.BookmarkTreeNode | null;
}

type BuiltinStatus = 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface DupEntry {
    id: string;
    title: string;
    url: string;
    folder: string;
    dateAdded?: number;
}

interface DuplicateGroup {
    normKey: string;
    entries: DupEntry[];
}

interface TagRow {
    id: string;
    title: string;
    url: string;
    folder: string;
    tags: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normUrl(url: string): string {
    try {
        const u = new URL(url);
        return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').toLowerCase();
    } catch {
        return url.toLowerCase();
    }
}

function collectDupEntries(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    parent: string,
    out: DupEntry[] = []
): DupEntry[] {
    for (const n of nodes) {
        if (n.url) out.push({ id: n.id, title: n.title, url: n.url, folder: parent, dateAdded: n.dateAdded });
        if (n.children) collectDupEntries(n.children, n.title || parent, out);
    }
    return out;
}

// The "canonical" copy a merge keeps, per the chosen policy: oldest = earliest
// bookmarked, newest = most recently bookmarked. The rest of the group is deleted.
function keptEntry(entries: DupEntry[], policy: KeepPolicy): DupEntry {
    const sorted = [...entries].sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0));
    return policy === 'oldest' ? sorted[0] : sorted[sorted.length - 1];
}

function formatDate(ms?: number): string {
    if (!ms) return 'unknown date';
    try {
        return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return 'unknown date';
    }
}

// Flatten the tree into tag rows, carrying each bookmark's parent-folder name.
function collectTagRows(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    parent: string,
    tagMap: Record<string, string[]>,
    out: TagRow[] = []
): TagRow[] {
    for (const n of nodes) {
        if (n.url) {
            out.push({ id: n.id, title: n.title, url: n.url, folder: parent, tags: tagMap[n.url] ?? [] });
        }
        if (n.children) collectTagRows(n.children, n.title || parent, tagMap, out);
    }
    return out;
}

// A folder choice for Smart Search: its id, an indented label, and the flat list
// of every bookmark beneath it (recursive).
interface FolderOption {
    id: string;
    label: string;
    bookmarks: { title: string; url: string }[];
}

function collectBookmarksFlat(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    out: { title: string; url: string }[] = []
): { title: string; url: string }[] {
    for (const n of nodes) {
        if (n.url) out.push({ title: n.title, url: n.url });
        if (n.children) collectBookmarksFlat(n.children, out);
    }
    return out;
}

function collectFolderOptions(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    depth: number,
    out: FolderOption[] = []
): FolderOption[] {
    for (const n of nodes) {
        if (n.children) {
            const indent = depth > 0 ? '  '.repeat(depth) : '';
            out.push({ id: n.id, label: `${indent}${n.title || 'Bookmarks'}`, bookmarks: collectBookmarksFlat(n.children) });
            collectFolderOptions(n.children, depth + 1, out);
        }
    }
    return out;
}

const ALL_FOLDERS_ID = '__all__';

// SVG circumference for r=15 circle
const RING_CIRC = 2 * Math.PI * 15; // ≈ 94.25

// ─── Component ────────────────────────────────────────────────────────────────

export const AISettingsPage: React.FC<AISettingsPageProps> = ({ onSave, onBack, currentFolder }) => {
    const [activeTab, setActiveTab] = useState<'settings' | 'autotag' | 'search' | 'duplicates'>('settings');

    // Guard the "Saved!" reset timers so they don't setState after the page unmounts
    // (the user can click Back during the ~1s confirmation window).
    const mountedRef = useRef(true);
    useEffect(() => () => { mountedRef.current = false; }, []);

    // ── Settings tab state ────────────────────────────────────────────────────
    const [mode, setMode] = useState<AIMode>('builtin');
    const [provider, setProvider] = useState<AIProvider>('openai');
    const [model, setModel] = useState(PROVIDERS[0].defaultModel);
    const [customUrl, setCustomUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [keyVisible, setKeyVisible] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // ── API-key validation / model discovery ──────────────────────────────────
    const [keyStatus, setKeyStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
    const [keyModels, setKeyModels] = useState<string[]>([]);
    const [keyMessage, setKeyMessage] = useState('');

    // ── Chrome Built-in AI status ─────────────────────────────────────────────
    const [builtinStatus, setBuiltinStatus] = useState<BuiltinStatus>('checking');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadLabel, setDownloadLabel] = useState('');
    const [isDownloading, setIsDownloading] = useState(false);

    // ── Smart Search tab state ────────────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<string[]>([]);
    const [searchError, setSearchError] = useState('');
    const [searchDone, setSearchDone] = useState(false);
    const [folderOptions, setFolderOptions] = useState<FolderOption[]>([]);
    const [searchFolderId, setSearchFolderId] = useState<string>(ALL_FOLDERS_ID);

    // ── Duplicate Finder tab state ────────────────────────────────────────────
    const [isScanning, setIsScanning] = useState(false);
    const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
    const [scanDone, setScanDone] = useState(false);
    const [keepPolicy, setKeepPolicy] = useState<KeepPolicy>('oldest');
    const [dupMenuOpen, setDupMenuOpen] = useState(false);

    // ── Auto-Tag tab state ────────────────────────────────────────────────────
    const [tagRows, setTagRows] = useState<TagRow[]>([]);
    const [tagScanDone, setTagScanDone] = useState(false);
    const [tagFilter, setTagFilter] = useState('');
    const [tagFolderId, setTagFolderId] = useState<string>(ALL_FOLDERS_ID);
    const [isTagging, setIsTagging] = useState(false);
    const [tagProgress, setTagProgress] = useState({ done: 0, total: 0 });
    const [addingFor, setAddingFor] = useState<string | null>(null);
    const [aiReady, setAiReady] = useState<AIAvailability | 'checking'>('checking');
    const [activeProvider, setActiveProvider] = useState('');
    const [tagError, setTagError] = useState('');
    const [tagFailCount, setTagFailCount] = useState(0);
    const [customTags, setCustomTags] = useState<string[]>([]);
    const [customTagsInput, setCustomTagsInput] = useState('');
    const [customTagsSaved, setCustomTagsSaved] = useState(false);
    const [prefTagsOpen, setPrefTagsOpen] = useState(false);

    // ── Load saved settings on mount ──────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const { settings, hasApiKey } = await loadAISettings();
            if (cancelled) return;
            setMode(settings.mode);
            setProvider(settings.cloud.provider);
            setModel(settings.cloud.model);
            setCustomUrl(settings.cloud.customUrl ?? '');
            if (hasApiKey) {
                const key = await getDecryptedApiKey();
                if (!cancelled) setApiKey(key);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, []);

    // ── Check Chrome Built-in AI status ───────────────────────────────────────
    useEffect(() => {
        if (activeTab !== 'settings' || mode !== 'builtin') return;
        let cancelled = false;
        const check = async () => {
            setBuiltinStatus('checking');
            if (typeof LanguageModel === 'undefined') {
                if (!cancelled) setBuiltinStatus('unsupported');
                return;
            }
            try {
                const avail = await LanguageModel.availability({
                    expectedInputs: [{ type: 'text', languages: ['en'] }],
                    expectedOutputs: [{ type: 'text', languages: ['en'] }],
                });
                if (cancelled) return;
                if (avail === 'available') setBuiltinStatus('available');
                else if (avail === 'after-download' || avail === 'downloadable') setBuiltinStatus('downloadable');
                else if (avail === 'downloading') setBuiltinStatus('downloading');
                else setBuiltinStatus('unavailable');
            } catch {
                if (!cancelled) setBuiltinStatus('unavailable');
            }
        };
        void check();
        return () => { cancelled = true; };
    }, [activeTab, mode]);

    // ── Validate the API key (or local endpoint) and discover models, debounced ─
    useEffect(() => {
        let cancelled = false;
        const meta = PROVIDERS.find(p => p.id === provider);
        const needsKey = meta?.requiresKey ?? true;
        const needsUrl = provider === 'ollama' || provider === 'custom';
        const ready = mode === 'cloud'
            && (!needsKey || apiKey.trim().length > 0)
            && (!needsUrl || customUrl.trim().length > 0);

        if (!ready) {
            // Nothing to validate yet — clear out of the synchronous effect body.
            const idle = setTimeout(() => {
                if (cancelled) return;
                setKeyStatus('idle'); setKeyModels([]); setKeyMessage('');
            }, 0);
            return () => { cancelled = true; clearTimeout(idle); };
        }

        const run = async () => {
            setKeyStatus('checking');
            const res = await validateProviderKey(provider, apiKey.trim(), model.trim(), customUrl.trim());
            if (cancelled) return;
            setKeyStatus(res.ok ? 'valid' : 'invalid');
            setKeyModels(res.models);
            setKeyMessage(res.message);
        };
        const t = setTimeout(() => { void run(); }, 600);
        return () => { cancelled = true; clearTimeout(t); };
    }, [mode, provider, apiKey, customUrl, model]);

    // ── Auto-Tag: load all bookmarks (with folder + persisted tags) on tab entry ─
    useEffect(() => {
        if (activeTab !== 'autotag' && activeTab !== 'search') return;
        let cancelled = false;
        const load = async () => {
            const [tree, allMeta, availRes, savedSettings, tagStatus] = await Promise.all([
                chrome.bookmarks.getTree(),
                storageIndex.getAll(),
                chrome.runtime.sendMessage({ type: 'CHECK_AI_AVAILABILITY' })
                    .catch(() => ({ available: 'unsupported' as AIAvailability })),
                loadAISettings(),
                chrome.runtime.sendMessage({ type: 'GET_TAG_STATUS' }).catch(() => null),
            ]);
            if (cancelled) return;

            // Restore the live progress / Stop indicator if a batch is still running
            // in the service worker (the popup was unmounted while we navigated away).
            const st = tagStatus as { isTagging?: boolean; done?: number; total?: number } | null;
            if (st?.isTagging) {
                setIsTagging(true);
                setTagProgress({ done: st.done ?? 0, total: st.total ?? 0 });
            }
            const tagMap: Record<string, string[]> = {};
            for (const [url, rec] of Object.entries(allMeta)) {
                if (rec.tags?.length) tagMap[url] = rec.tags;
            }
            setTagRows(collectTagRows(tree, '', tagMap));

            // Folder choices for Smart Search (start below the invisible root node).
            const roots = tree[0]?.children ?? tree;
            const folders = collectFolderOptions(roots, 0);
            setFolderOptions(folders);
            // Default the search scope to the folder the user was viewing, if it has bookmarks.
            const preferred = currentFolder?.id && folders.some(f => f.id === currentFolder.id)
                ? currentFolder.id
                : ALL_FOLDERS_ID;
            setSearchFolderId(prev => (prev === ALL_FOLDERS_ID ? preferred : prev));

            setAiReady((availRes as { available: AIAvailability })?.available ?? 'unsupported');
            const s = savedSettings.settings;
            setCustomTags(s.customTags ?? []);
            setCustomTagsInput((s.customTags ?? []).join(', '));
            if (s.mode === 'builtin') {
                setActiveProvider("Chrome Built-in AI (Gemini Nano)");
            } else {
                const label = PROVIDERS.find(p => p.id === s.cloud.provider)?.label ?? s.cloud.provider;
                setActiveProvider(`${label} · ${s.cloud.model}`);
            }
            setTagScanDone(true);
        };
        void load();
        return () => { cancelled = true; };
    }, [activeTab, currentFolder?.id]);

    // ── Auto-Tag: live-update rows as the service worker reports progress ───────
    useEffect(() => {
        const listener = (msg: { type: string; url?: string; tags?: string[]; total?: number; error?: string }) => {
            if (msg.type === 'TAG_BATCH_STARTED') {
                setIsTagging(true);
                setTagError('');
                setTagFailCount(0);
                setTagProgress({ done: 0, total: msg.total ?? 0 });
            } else if (msg.type === 'TAG_UPDATED' && msg.url && msg.tags) {
                const url = msg.url, tags = msg.tags;
                setTagRows(prev => prev.map(r => (r.url === url ? { ...r, tags } : r)));
                setTagProgress(prev => ({ ...prev, done: prev.done + 1 }));
            } else if (msg.type === 'TAG_FAILED') {
                setTagProgress(prev => ({ ...prev, done: prev.done + 1 }));
                setTagFailCount(c => c + 1);
                if (msg.error) setTagError(msg.error);
            } else if (msg.type === 'TAG_BATCH_FAILED') {
                setIsTagging(false);
                setTagError(msg.error || 'Auto-tagging failed.');
            } else if (msg.type === 'TAG_BATCH_DONE') {
                setIsTagging(false);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // ── Handlers: Settings ────────────────────────────────────────────────────

    const handleProviderChange = (p: AIProvider) => {
        setProvider(p);
        const meta = PROVIDERS.find(x => x.id === p);
        if (meta) setModel(meta.defaultModel);
        setApiKey('');
        setCustomUrl('');
        setKeyStatus('idle');
        setKeyModels([]);
        setKeyMessage('');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveAISettings(
                { mode, cloud: { provider, model, customUrl: customUrl || undefined } },
                mode === 'cloud' ? apiKey : undefined
            );
            setSaved(true);
            setTimeout(() => { if (!mountedRef.current) return; setSaved(false); onSave(); }, 900);
        } finally {
            setSaving(false);
        }
    };

    const handleBuiltinDownload = async () => {
        setIsDownloading(true);
        setBuiltinStatus('downloading');
        setDownloadProgress(0);
        setDownloadLabel('Starting download…');
        try {
            const session = await LanguageModel.create({
                expectedInputs: [{ type: 'text', languages: ['en'] }],
                expectedOutputs: [{ type: 'text', languages: ['en'] }],
                monitor(m: EventTarget) {
                    m.addEventListener('downloadprogress', (e: Event) => {
                        const pct = Math.round((e as AIDownloadProgressEvent).loaded * 100);
                        setDownloadProgress(pct);
                        setDownloadLabel(pct < 100 ? `Downloading Gemini Nano… ${pct}%` : 'Download complete!');
                    });
                },
            });
            session.destroy();
            setBuiltinStatus('available');
            setDownloadLabel('');
        } catch {
            setBuiltinStatus('downloadable');
            setDownloadLabel('Download failed. Please try again.');
        } finally {
            setIsDownloading(false);
        }
    };

    // ── Handlers: Smart Search ────────────────────────────────────────────────

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setIsSearching(true);
        setSearchError('');
        setSearchDone(false);
        setSearchResults([]);
        try {
            const bookmarks = searchScopeBookmarks;
            const resp = await chrome.runtime.sendMessage({
                type: 'AI_SEARCH',
                query: searchQuery,
                bookmarks,
            }) as { urls?: string[]; error?: string };
            if (resp.error) {
                setSearchError(resp.error);
            } else {
                setSearchResults(resp.urls ?? []);
                setSearchDone(true);
            }
        } catch (err) {
            setSearchError(String(err));
        } finally {
            setIsSearching(false);
        }
    };

    // ── Handlers: Duplicate Finder ────────────────────────────────────────────

    const handleScan = async () => {
        setIsScanning(true);
        setScanDone(false);
        setDuplicates([]);
        try {
            const tree = await chrome.bookmarks.getTree();
            const all = collectDupEntries(tree, '');
            const map = new Map<string, DupEntry[]>();
            for (const e of all) {
                const key = normUrl(e.url);
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(e);
            }
            const groups: DuplicateGroup[] = [];
            map.forEach((entries, normKey) => { if (entries.length > 1) groups.push({ normKey, entries }); });
            groups.sort((a, b) => b.entries.length - a.entries.length);
            setDuplicates(groups);
            setScanDone(true);
        } finally {
            setIsScanning(false);
        }
    };

    const handleDeleteBookmark = async (id: string, groupKey: string) => {
        await chrome.bookmarks.remove(id);
        setDuplicates(prev => prev
            .map(g => g.normKey === groupKey
                ? { ...g, entries: g.entries.filter(e => e.id !== id) }
                : g
            )
            .filter(g => g.entries.length > 1)
        );
    };

    // Merge one group per the current keep-policy: keep one copy, delete the rest.
    const handleMergeGroup = async (group: DuplicateGroup) => {
        const keep = keptEntry(group.entries, keepPolicy);
        const toRemove = group.entries.filter(e => e.id !== keep.id);
        await Promise.all(toRemove.map(e => chrome.bookmarks.remove(e.id).catch(() => { })));
        setDuplicates(prev => prev.filter(g => g.normKey !== group.normKey));
    };

    // Merge every group in one click, keeping the oldest or newest copy.
    const handleMergeAll = async (policy: KeepPolicy) => {
        setDupMenuOpen(false);
        setKeepPolicy(policy);
        if (duplicates.length === 0) return;
        const total = duplicates.reduce((n, g) => n + (g.entries.length - 1), 0);
        const kept = policy === 'oldest' ? 'OLDEST' : 'NEWEST';
        if (!confirm(
            `Remove ${total} duplicate bookmark${total !== 1 ? 's' : ''} across ${duplicates.length} group` +
            `${duplicates.length !== 1 ? 's' : ''}?\n\n` +
            `The ${kept} copy in each group is kept; the others are deleted. This cannot be undone.`
        )) return;
        const removals: string[] = [];
        for (const g of duplicates) {
            const keep = keptEntry(g.entries, policy);
            for (const e of g.entries) if (e.id !== keep.id) removals.push(e.id);
        }
        await Promise.all(removals.map(id => chrome.bookmarks.remove(id).catch(() => { })));
        setDuplicates([]);
    };

    // ── Handlers: Auto-Tag ────────────────────────────────────────────────────

    const runAutoTag = (onlyUntagged: boolean) => {
        const targets = scopedTagRows
            .filter(r => !onlyUntagged || r.tags.length === 0)
            .map(r => ({ url: r.url, title: r.title }));
        if (targets.length === 0) return;
        chrome.runtime.sendMessage({ type: 'AUTO_TAG', bookmarks: targets }).catch(() => { });
    };

    const stopTagging = () => {
        chrome.runtime.sendMessage({ type: 'STOP_TAG' }).catch(() => { });
    };

    // Persist preferred tags (on blur). Normalises the comma-separated input.
    const handleSaveCustomTags = (raw: string) => {
        const parsed = parseCustomTags(raw);
        setCustomTags(parsed);
        setCustomTagsInput(parsed.join(', '));
        void saveCustomTags(parsed).then(() => {
            setCustomTagsSaved(true);
            setTimeout(() => { if (mountedRef.current) setCustomTagsSaved(false); }, 1500);
        });
    };

    // Manual tag edits write straight to storageIndex and notify the popup (via a
    // TAG_EDITED broadcast) so its filter pills stay in sync.
    const persistTags = async (row: TagRow, newTags: string[]) => {
        const existing = await storageIndex.get(row.url);
        if (existing) {
            await storageIndex.set({ ...existing, tags: newTags });
        } else {
            await storageIndex.set({ id: row.url, url: row.url, title: row.title, status: 'none', tags: newTags });
        }
        setTagRows(prev => prev.map(r => (r.url === row.url ? { ...r, tags: newTags } : r)));
        // Distinct from TAG_UPDATED so the popup syncs filter pills without the
        // batch-progress listener counting a manual edit as a tagged bookmark.
        chrome.runtime.sendMessage({ type: 'TAG_EDITED', url: row.url, tags: newTags }).catch(() => { });
    };

    const handleAddTag = (row: TagRow, raw: string) => {
        const tag = raw.trim();
        setAddingFor(null);
        if (!tag || row.tags.includes(tag)) return;
        void persistTags(row, [...row.tags, tag]);
    };

    const handleRemoveTag = (row: TagRow, tag: string) => {
        void persistTags(row, row.tags.filter(t => t !== tag));
    };

    // ── Derived ───────────────────────────────────────────────────────────────

    const currentMeta = PROVIDERS.find(p => p.id === provider);
    const needsCustomUrl = provider === 'ollama' || provider === 'custom';
    const canSave = mode === 'builtin' || (
        mode === 'cloud' && model.trim().length > 0 &&
        (currentMeta?.requiresKey ? apiKey.trim().length > 0 : true) &&
        (!needsCustomUrl || customUrl.trim().length > 0)
    );

    // Bookmarks in the chosen Smart Search scope (a folder, or everything).
    // Nested folders mean a bookmark appears under its folder AND every ancestor,
    // so the "all" set must be de-duplicated by URL (count + scope use the same list).
    const allBookmarks = Array.from(
        new Map(folderOptions.flatMap(f => f.bookmarks).map(b => [b.url, b])).values()
    );
    const searchScopeBookmarks = searchFolderId === ALL_FOLDERS_ID
        ? allBookmarks
        : (folderOptions.find(f => f.id === searchFolderId)?.bookmarks ?? []);
    const searchCap = mode === 'builtin' ? SEARCH_CAP_BUILTIN : SEARCH_CAP_CLOUD;
    const matchedNodes = searchResults.length > 0
        ? searchScopeBookmarks.filter(b => searchResults.includes(b.url))
        : [];

    // Auto-Tag folder scope (default: everything). The table, counts and actions
    // all operate on this scoped subset.
    const tagScopeUrls = tagFolderId === ALL_FOLDERS_ID
        ? null
        : new Set((folderOptions.find(f => f.id === tagFolderId)?.bookmarks ?? []).map(b => b.url));
    const scopedTagRows = tagScopeUrls ? tagRows.filter(r => tagScopeUrls.has(r.url)) : tagRows;

    const tagFilterQ = tagFilter.trim().toLowerCase();
    const filteredTagRows = tagFilterQ
        ? scopedTagRows.filter(r =>
            r.title.toLowerCase().includes(tagFilterQ) ||
            r.url.toLowerCase().includes(tagFilterQ) ||
            r.folder.toLowerCase().includes(tagFilterQ) ||
            r.tags.some(t => t.toLowerCase().includes(tagFilterQ)))
        : scopedTagRows;
    const taggedCount = scopedTagRows.filter(r => r.tags.length > 0).length;
    const untaggedCount = scopedTagRows.length - taggedCount;
    const aiUsable = aiReady === 'available' || aiReady === 'after-download';

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="ai-settings-page">

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="ai-settings-header">
                <button className="ai-settings-back" onClick={onBack}>
                    <ChevronLeft size={15} /> Back
                </button>
                <h2 className="ai-settings-title">AI Settings</h2>
                <p className="ai-settings-subtitle">Configure AI provider and explore AI-powered features.</p>
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────────── */}
            <div className="ai-tabs">
                {(['settings', 'autotag', 'search', 'duplicates'] as const).map(tab => (
                    <button
                        key={tab}
                        className={`ai-tab ${activeTab === tab ? 'ai-tab--active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'settings' ? '⚙ Provider Settings'
                            : tab === 'autotag' ? '🏷 Auto-Tag'
                            : tab === 'search' ? '🔍 Smart Search'
                            : '🧹 Duplicate Finder'}
                    </button>
                ))}
            </div>

            {/* ══════════════ SETTINGS TAB ══════════════════════════════════ */}
            {activeTab === 'settings' && (
                <>
                    <div className="ai-section-label">
                        <span className="ai-step-badge">1</span>
                        Text Generation Settings
                        <span className="ai-section-hint">Choose your AI provider and model.</span>
                    </div>

                    {/* Provider cards */}
                    <div className="ai-cards">
                        <div
                            className={`ai-card ${mode === 'builtin' ? 'ai-card--selected' : ''}`}
                            onClick={() => setMode('builtin')}
                            role="button"
                            aria-pressed={mode === 'builtin'}
                        >
                            {mode === 'builtin' && <div className="ai-card-check">✓</div>}
                            <div className="ai-card-icon">✨</div>
                            <div className="ai-card-name">Use Chrome's Built-in AI</div>
                            <div className="ai-card-powered">Powered by Gemini Nano</div>
                            <div className="ai-card-chips">
                                <span className="ai-chip ai-chip--green">Free</span>
                                <span className="ai-chip ai-chip--blue">Private</span>
                                <span className="ai-chip ai-chip--gray">No setup</span>
                            </div>
                            <p className="ai-card-desc">Runs entirely on your device — no API key needed</p>
                        </div>

                        <div
                            className={`ai-card ${mode === 'cloud' ? 'ai-card--selected' : ''}`}
                            onClick={() => setMode('cloud')}
                            role="button"
                            aria-pressed={mode === 'cloud'}
                        >
                            {mode === 'cloud' && <div className="ai-card-check">✓</div>}
                            <div className="ai-card-icon">🔑</div>
                            <div className="ai-card-name">Use your own API key</div>
                            <div className="ai-card-powered">OpenAI, Gemini, Anthropic & more</div>
                            <div className="ai-card-chips">
                                <span className="ai-chip ai-chip--gray">13 providers</span>
                                <span className="ai-chip ai-chip--gray">Cloud models</span>
                                <span className="ai-chip ai-chip--gray">Full control</span>
                            </div>
                            <p className="ai-card-desc">Bring your own key from any supported provider</p>
                        </div>
                    </div>

                    {/* Chrome Built-in AI status panel */}
                    {mode === 'builtin' && (
                        <div className="chrome-ai-panel">
                            <div className="chrome-ai-features">
                                <span className="chrome-ai-feature"><strong>🔒 Private</strong> — On-device processing</span>
                                <span className="chrome-ai-feature"><strong>⚡ Free</strong> — No API key needed</span>
                                <span className="chrome-ai-feature"><strong>🔌 Offline</strong> — Works without internet</span>
                            </div>

                            {builtinStatus === 'checking' && (
                                <span className="chrome-ai-status chrome-ai-status--checking">Checking availability…</span>
                            )}
                            {builtinStatus === 'available' && (
                                <>
                                    <span className="chrome-ai-status chrome-ai-status--ready">✓ Ready to use</span>
                                    <div className="chrome-ai-status-detail chrome-ai-ready-msg">✓ Gemini Nano is installed and ready.</div>
                                </>
                            )}
                            {builtinStatus === 'downloadable' && (
                                <>
                                    <span className="chrome-ai-status chrome-ai-status--download">↓ Model download required</span>
                                    <div className="chrome-ai-status-detail">
                                        Model needs a one-time download (~1.7 GB).{' '}
                                        <button
                                            className="chrome-ai-download-btn"
                                            onClick={handleBuiltinDownload}
                                            disabled={isDownloading}
                                        >
                                            Download Now
                                        </button>
                                    </div>
                                </>
                            )}
                            {(builtinStatus === 'downloading' || isDownloading) && (
                                <>
                                    <span className="chrome-ai-status chrome-ai-status--download">↓ Downloading…</span>
                                    <div className="chrome-ai-download-row">
                                        <div className="chrome-ai-download-indicator">
                                            <svg viewBox="0 0 40 40" width="40" height="40" style={{ transform: 'rotate(-90deg)' }}>
                                                <circle cx="20" cy="20" r="15" fill="none" stroke="#e8eaed" strokeWidth="3" />
                                                <circle
                                                    cx="20" cy="20" r="15" fill="none" stroke="#1a73e8" strokeWidth="3"
                                                    strokeDasharray={RING_CIRC}
                                                    strokeDashoffset={RING_CIRC * (1 - downloadProgress / 100)}
                                                    strokeLinecap="round"
                                                />
                                            </svg>
                                            <div className="chrome-ai-pct">{downloadProgress}%</div>
                                        </div>
                                        <span className="chrome-ai-download-label">{downloadLabel}</span>
                                    </div>
                                </>
                            )}
                            {builtinStatus === 'unavailable' && (
                                <>
                                    <span className="chrome-ai-status chrome-ai-status--unavailable">⚠ Not available on this device</span>
                                    <div className="chrome-ai-status-detail">Your device may not meet the hardware requirements.</div>
                                </>
                            )}
                            {builtinStatus === 'unsupported' && (
                                <>
                                    <span className="chrome-ai-status chrome-ai-status--unavailable">⚠ Chrome 138+ required</span>
                                    <div className="chrome-ai-status-detail">Update Chrome to use on-device AI, or choose a cloud provider.</div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Cloud provider form */}
                    {mode === 'cloud' && (
                        <div className="ai-cloud-form">
                            <div className="ai-form-row">
                                <label className="ai-form-label">Provider</label>
                                <select
                                    className="ai-form-select"
                                    value={provider}
                                    onChange={e => handleProviderChange(e.target.value as AIProvider)}
                                >
                                    {PROVIDERS.map(p => (
                                        <option key={p.id} value={p.id}>{p.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="ai-form-row">
                                <label className="ai-form-label">Model Name</label>
                                <input
                                    className="ai-form-input"
                                    value={model}
                                    onChange={e => setModel(e.target.value)}
                                    placeholder={currentMeta?.defaultModel ?? 'model-name'}
                                />
                                <span className="ai-form-hint">Enter the model name exactly as supported by your provider.</span>
                            </div>

                            {needsCustomUrl && (
                                <div className="ai-form-row">
                                    <label className="ai-form-label">
                                        {provider === 'ollama' ? 'Ollama Base URL' : 'Custom Endpoint Base URL'}
                                    </label>
                                    <input
                                        className="ai-form-input"
                                        value={customUrl}
                                        onChange={e => setCustomUrl(e.target.value)}
                                        placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://your-api.com/v1'}
                                    />
                                    <span className="ai-form-hint">
                                        {provider === 'ollama'
                                            ? 'Default is http://localhost:11434. Change if using a remote Ollama instance.'
                                            : 'OpenAI-compatible base URL. /chat/completions will be appended.'}
                                    </span>
                                </div>
                            )}

                            {(currentMeta?.requiresKey || needsCustomUrl) && (
                                <div className="ai-form-row">
                                    <label className="ai-form-label">
                                        {currentMeta?.requiresKey ? 'API Key' : 'API Key (optional)'}
                                    </label>
                                    <div className="ai-key-wrapper">
                                        <input
                                            className="ai-form-input ai-key-input"
                                            type={keyVisible ? 'text' : 'password'}
                                            value={apiKey}
                                            onChange={e => setApiKey(e.target.value)}
                                            placeholder={currentMeta?.requiresKey
                                                ? currentMeta.keyPlaceholder
                                                : 'Leave blank if your server needs no key'}
                                            autoComplete="off"
                                        />
                                        <button className="ai-key-eye" type="button"
                                            onClick={() => setKeyVisible(v => !v)}>
                                            {keyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                                        </button>
                                    </div>
                                    {keyStatus === 'idle' || keyStatus === 'invalid' ? (
                                        <span className="ai-form-hint">
                                            {currentMeta?.requiresKey
                                                ? 'Stored encrypted on your device. Never sent anywhere except your chosen provider.'
                                                : 'Optional — most local servers (Ollama, LM Studio) need no key. If yours requires one, it is stored encrypted and sent only to your endpoint.'}
                                        </span>
                                    ) : null}
                                </div>
                            )}

                            {/* Validation feedback + discovered models (key providers and local endpoints) */}
                            {keyStatus !== 'idle' && (
                                <div className={`ai-key-feedback ai-key-feedback--${keyStatus}`}>
                                    {keyStatus === 'checking' && <><span className="ai-spinner ai-spinner--dark" /> Verifying…</>}
                                    {keyStatus === 'valid' && <>✓ {keyMessage || 'Verified.'}</>}
                                    {keyStatus === 'invalid' && <>✕ {keyMessage || 'Could not verify.'}</>}
                                </div>
                            )}
                            {keyStatus === 'valid' && keyModels.length > 0 && (
                                <div className="ai-key-models">
                                    <span className="ai-key-models-label">Available models (click to use):</span>
                                    <div className="ai-key-models-list">
                                        {keyModels.map(m => (
                                            <button
                                                key={m}
                                                type="button"
                                                className={`ai-model-chip ${model === m ? 'ai-model-chip--active' : ''}`}
                                                onClick={() => setModel(m)}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="ai-save-row">
                        <button
                            className={`ai-save-btn ${saved ? 'ai-save-btn--saved' : ''}`}
                            onClick={handleSave}
                            disabled={saving || !canSave}
                        >
                            {saved ? <><CheckCircle2 size={15} /> Saved!</> : saving ? 'Saving…' : 'Save Settings'}
                        </button>
                    </div>
                </>
            )}

            {/* ══════════════ AUTO-TAG TAB ══════════════════════════════════ */}
            {activeTab === 'autotag' && (
                <div className="ai-feature-panel">
                    <div className="ai-autotag-top">
                        <div className="ai-feature-header">
                            <div className="ai-feature-title">🏷 Auto-Tag</div>
                            <p className="ai-feature-desc">
                                Let AI categorise your bookmarks into topic tags
                                {activeProvider && <> using <strong className="ai-provider-inline">{activeProvider}</strong></>}.
                                {' '}Add, edit or delete tags by hand any time — changes save instantly.
                            </p>
                        </div>

                        <div className="ai-pref-wrap">
                            <button className="ai-pref-toggle" onClick={() => setPrefTagsOpen(o => !o)}>
                                🏷 Preferred tags
                                {customTags.length > 0 && <span className="ai-pref-count">{customTags.length}</span>}
                                <ChevronDown size={14} />
                            </button>
                            {prefTagsOpen && (
                                <>
                                    <div className="ai-merge-menu-backdrop" onClick={() => setPrefTagsOpen(false)} />
                                    <div className="ai-pref-popover">
                                        <label className="ai-form-label" htmlFor="ai-pref-input">
                                            Preferred tags <span className="ai-pref-optional">(optional)</span>
                                            {customTagsSaved && <span className="ai-pref-saved"><CheckCircle2 size={13} /> Saved</span>}
                                        </label>
                                        <input
                                            id="ai-pref-input"
                                            className="ai-form-input"
                                            autoFocus
                                            value={customTagsInput}
                                            onChange={e => setCustomTagsInput(e.target.value)}
                                            onBlur={e => handleSaveCustomTags(e.target.value)}
                                            placeholder="e.g. Tamil Video, Tutorial, Crash Course"
                                        />
                                        <span className="ai-form-hint">
                                            The AI prefers these when they fit and matches their specificity — useful for finer
                                            categories than the defaults (e.g. “Tamil Video” instead of “Video”). It can still use
                                            other tags. Leave blank for general tagging.
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {!aiUsable && aiReady !== 'checking' && (
                        <div className="ai-result-error">
                            No AI provider is ready. Open <strong>Provider Settings</strong> to enable
                            Chrome's built-in AI or add an API key first.
                        </div>
                    )}

                    {tagError && (
                        <div className="ai-result-error">
                            {tagFailCount > 0 && !isTagging
                                ? `${tagFailCount} bookmark${tagFailCount !== 1 ? 's' : ''} could not be tagged. `
                                : ''}
                            {tagError}
                        </div>
                    )}

                    <div className="ai-tag-toolbar">
                        {isTagging ? (
                            <button className="ai-scan-btn ai-scan-btn--stop" onClick={stopTagging}>
                                <StopCircle size={15} /> Stop — {tagProgress.done}/{tagProgress.total}
                            </button>
                        ) : (
                            <button
                                className="ai-scan-btn"
                                onClick={() => runAutoTag(true)}
                                disabled={!aiUsable || untaggedCount === 0}
                                title={untaggedCount === 0 ? 'Every bookmark already has tags' : ''}
                            >
                                <Sparkles size={15} /> Auto-Tag Untagged ({untaggedCount})
                            </button>
                        )}
                        <select
                            className="ai-inline-select ai-tag-scope"
                            value={tagFolderId}
                            onChange={e => setTagFolderId(e.target.value)}
                            title="Limit Auto-Tag to a folder"
                        >
                            <option value={ALL_FOLDERS_ID}>All bookmarks ({tagRows.length})</option>
                            {folderOptions.map(f => (
                                <option key={f.id} value={f.id}>{f.label} ({f.bookmarks.length})</option>
                            ))}
                        </select>
                        <button
                            className="ai-tag-retag-btn"
                            onClick={() => runAutoTag(false)}
                            disabled={isTagging || !aiUsable || scopedTagRows.length === 0}
                        >
                            Re-tag All
                        </button>
                        <input
                            className="ai-form-input ai-tag-filter"
                            value={tagFilter}
                            onChange={e => setTagFilter(e.target.value)}
                            placeholder="Filter by title, URL, folder or tag…"
                        />
                    </div>

                    {tagScanDone && (
                        <div className="ai-results-meta">
                            {scopedTagRows.length === 0
                                ? (tagFolderId === ALL_FOLDERS_ID ? 'No bookmarks found.' : 'No bookmarks in this folder.')
                                : `${taggedCount} of ${scopedTagRows.length} bookmarks tagged` +
                                  (tagFilterQ ? ` · ${filteredTagRows.length} shown` : '')}
                        </div>
                    )}

                    {filteredTagRows.length > 0 && (
                        <div className="ai-tag-table-wrap">
                            <table className="ai-tag-table">
                                <thead>
                                    <tr>
                                        <th className="ai-tag-col-folder">Folder</th>
                                        <th className="ai-tag-col-bm">Bookmark</th>
                                        <th className="ai-tag-col-tags">Tags</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredTagRows.map(row => (
                                        <tr key={row.id}>
                                            <td className="ai-tag-folder">{row.folder || '—'}</td>
                                            <td className="ai-tag-bm">
                                                <span className="ai-tag-bm-title">{row.title || row.url}</span>
                                                <span className="ai-tag-bm-url">{row.url}</span>
                                            </td>
                                            <td className="ai-tag-cell">
                                                <div className="ai-tag-chips">
                                                    {row.tags.map(t => (
                                                        <span key={t} className="ai-tag-chip">
                                                            {t}
                                                            <button
                                                                className="ai-tag-chip-x"
                                                                title="Remove tag"
                                                                onClick={() => handleRemoveTag(row, t)}
                                                            >
                                                                <X size={11} />
                                                            </button>
                                                        </span>
                                                    ))}
                                                    {addingFor === row.url ? (
                                                        <input
                                                            className="ai-tag-add-input"
                                                            list="ai-tag-options"
                                                            autoFocus
                                                            placeholder="tag…"
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') handleAddTag(row, (e.target as HTMLInputElement).value);
                                                                else if (e.key === 'Escape') setAddingFor(null);
                                                            }}
                                                            onBlur={e => handleAddTag(row, e.target.value)}
                                                        />
                                                    ) : (
                                                        <button
                                                            className="ai-tag-add-btn"
                                                            title="Add tag"
                                                            onClick={() => setAddingFor(row.url)}
                                                        >
                                                            <Plus size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <datalist id="ai-tag-options">
                                {Array.from(new Set([...customTags, ...AI_TAGS])).map(t => <option key={t} value={t} />)}
                            </datalist>
                        </div>
                    )}
                </div>
            )}

            {/* ══════════════ SMART SEARCH TAB ══════════════════════════════ */}
            {activeTab === 'search' && (
                <div className="ai-feature-panel">
                    <div className="ai-feature-header">
                        <div className="ai-feature-title">🔍 Smart Search</div>
                        <p className="ai-feature-desc">
                            Find bookmarks in{' '}
                            <select
                                className="ai-inline-select"
                                value={searchFolderId}
                                onChange={e => setSearchFolderId(e.target.value)}
                            >
                                <option value={ALL_FOLDERS_ID}>All bookmarks ({allBookmarks.length})</option>
                                {folderOptions.map(f => (
                                    <option key={f.id} value={f.id}>{f.label} ({f.bookmarks.length})</option>
                                ))}
                            </select>
                            {' '}using natural language
                            {activeProvider && <>, via <strong className="ai-provider-inline">{activeProvider}</strong></>}.
                        </p>
                        <span className="ai-form-hint">
                            {searchScopeBookmarks.length} bookmark{searchScopeBookmarks.length !== 1 ? 's' : ''} in scope
                            {searchScopeBookmarks.length > searchCap ? ` — only the first ${searchCap} are searched.` : '.'}
                        </span>
                    </div>

                    <div className="ai-search-row">
                        <input
                            className="ai-form-input ai-search-input"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !isSearching && handleSearch()}
                            placeholder='e.g. "developer tools", "finance articles", "AI resources"'
                        />
                        <button
                            className="ai-search-btn"
                            onClick={handleSearch}
                            disabled={isSearching || !searchQuery.trim() || searchScopeBookmarks.length === 0}
                        >
                            {isSearching ? <span className="ai-spinner" /> : <Search size={15} />}
                            {isSearching ? 'Searching…' : 'Search'}
                        </button>
                    </div>

                    {searchError && (
                        <div className="ai-result-error">{searchError}</div>
                    )}

                    {searchDone && !searchError && (
                        <div className="ai-search-results">
                            <div className="ai-results-meta">
                                {matchedNodes.length === 0
                                    ? 'No matching bookmarks found.'
                                    : `Found ${matchedNodes.length} matching bookmark${matchedNodes.length !== 1 ? 's' : ''}`}
                            </div>
                            {matchedNodes.map(n => (
                                <div key={n.url} className="ai-result-item">
                                    <div className="ai-result-info">
                                        <span className="ai-result-title">{n.title || n.url}</span>
                                        <span className="ai-result-url">{n.url}</span>
                                    </div>
                                    <div className="ai-result-actions">
                                        <button
                                            className="ai-result-action"
                                            title="Open"
                                            onClick={() => chrome.tabs.create({ url: n.url, active: true })}
                                        >
                                            <ExternalLink size={14} />
                                        </button>
                                        <button
                                            className="ai-result-action"
                                            title="Copy URL"
                                            onClick={() => navigator.clipboard.writeText(n.url)}
                                        >
                                            <Copy size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ══════════════ DUPLICATE FINDER TAB ══════════════════════════ */}
            {activeTab === 'duplicates' && (
                <div className="ai-feature-panel">
                    <div className="ai-feature-header">
                        <div className="ai-feature-title">🧹 Duplicate Finder</div>
                        <p className="ai-feature-desc">
                            Scans all your bookmarks across every folder and finds URLs that appear more than once.
                            No AI needed — runs entirely in your browser.
                        </p>
                    </div>

                    <div className="ai-dup-controls">
                        <button
                            className="ai-scan-btn"
                            onClick={handleScan}
                            disabled={isScanning}
                        >
                            {isScanning ? <><span className="ai-spinner" /> Scanning…</> : '🔎 Scan for Duplicates'}
                        </button>
                        {scanDone && !isScanning && duplicates.length > 0 && (
                            <div className="ai-merge-menu-wrap">
                                <button className="ai-merge-all-btn" onClick={() => setDupMenuOpen(o => !o)}>
                                    ✨ Remove All Duplicates <ChevronDown size={14} />
                                </button>
                                {dupMenuOpen && (
                                    <>
                                        <div className="ai-merge-menu-backdrop" onClick={() => setDupMenuOpen(false)} />
                                        <div className="ai-merge-menu">
                                            <button className="ai-merge-menu-item" onClick={() => handleMergeAll('oldest')}>
                                                <span className="ai-merge-menu-title">Keep oldest copy</span>
                                                <span className="ai-merge-menu-desc">Delete newer duplicates (earliest bookmarked wins)</span>
                                            </button>
                                            <button className="ai-merge-menu-item" onClick={() => handleMergeAll('newest')}>
                                                <span className="ai-merge-menu-title">Keep newest copy</span>
                                                <span className="ai-merge-menu-desc">Delete older duplicates (most recently bookmarked wins)</span>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        {scanDone && !isScanning && duplicates.length > 0 && (
                            <div className="ai-keep-toggle">
                                <span className="ai-keep-toggle-label">Currently highlighting:</span>
                                {(['oldest', 'newest'] as const).map(p => (
                                    <button
                                        key={p}
                                        className={`ai-keep-toggle-btn ${keepPolicy === p ? 'ai-keep-toggle-btn--active' : ''}`}
                                        onClick={() => setKeepPolicy(p)}
                                    >
                                        {p === 'oldest' ? 'Oldest' : 'Newest'}
                                    </button>
                                ))}
                                <span className="ai-keep-toggle-hint">— kept on merge; the rest are deleted.</span>
                            </div>
                        )}
                    </div>

                    {scanDone && !isScanning && (
                        <div className="ai-dup-results">
                            <div className="ai-results-meta">
                                {duplicates.length === 0
                                    ? '✓ No duplicates found — your bookmark collection is clean!'
                                    : `Found ${duplicates.length} group${duplicates.length !== 1 ? 's' : ''} of duplicates.`}
                            </div>
                            {duplicates.map(group => {
                                const keepId = keptEntry(group.entries, keepPolicy).id;
                                return (
                                    <div key={group.normKey} className="ai-dup-group">
                                        <div className="ai-dup-group-head">
                                            <span className="ai-dup-group-url">{group.normKey}</span>
                                            <button
                                                className="ai-dup-merge-btn"
                                                title={`Keep the ${keepPolicy} copy, delete the others`}
                                                onClick={() => handleMergeGroup(group)}
                                            >
                                                Merge ({group.entries.length - 1} to delete)
                                            </button>
                                        </div>
                                        {[...group.entries]
                                            .sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0))
                                            .map(e => {
                                                const isKept = e.id === keepId;
                                                return (
                                                    <div key={e.id} className={`ai-result-item ${isKept ? 'ai-result-item--kept' : ''}`}>
                                                        <div className="ai-result-info">
                                                            <span className="ai-result-title">
                                                                {e.title || e.url}
                                                                {isKept && <span className="ai-dup-keep-badge">Kept</span>}
                                                            </span>
                                                            <span className="ai-result-url">{e.url}</span>
                                                            <span className="ai-dup-meta">
                                                                📁 {e.folder || '—'} · 🕘 {formatDate(e.dateAdded)}
                                                            </span>
                                                        </div>
                                                        <div className="ai-result-actions">
                                                            <button
                                                                className="ai-result-action"
                                                                title="Open"
                                                                onClick={() => chrome.tabs.create({ url: e.url, active: true })}
                                                            >
                                                                <ExternalLink size={14} />
                                                            </button>
                                                            <button
                                                                className="ai-result-action ai-result-action--danger"
                                                                title={isKept ? 'This is the copy that would be kept' : 'Delete this bookmark'}
                                                                disabled={isKept}
                                                                onClick={() => handleDeleteBookmark(e.id, group.normKey)}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
