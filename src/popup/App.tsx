// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAITagger } from './hooks/useAITagger';
import { AISettingsPage } from './components/AISettingsPage';
import './App.css';
import '../components/shared.css';
import { backupManager, BackupFormatError } from '../lib/backup_manager';
import { Sidebar } from '../components/Sidebar';
import { MainContent } from '../components/MainContent';
import { TopBar } from '../components/TopBar';
import { ContextMenu } from '../components/ContextMenu';
import { WelcomeModal } from '../components/WelcomeModal';
import { TrashView } from '../components/TrashView';
import { Toast } from '../components/Toast';
import { useSettings } from './hooks/useSettings';
import { useBookmarkTree } from './hooks/useBookmarkTree';
import { useStorageWarning } from './hooks/useStorageWarning';
import { useClipboard } from './hooks/useClipboard';
import { useThumbnails } from './hooks/useThumbnails';
import { useContextMenu } from './hooks/useContextMenu';
import { useToast } from './hooks/useToast';
import { useTrash, type DeleteTarget } from './hooks/useTrash';
import { useMediaQuery, NARROW_QUERY } from './hooks/useMediaQuery';
import { useFolderPrefs } from './hooks/useFolderPrefs';
import { useLinkMeta } from './hooks/useLinkMeta';
import { useSelection } from './hooks/useSelection';
import { useHistoryStats } from './hooks/useHistoryStats';
import { SelectionBar } from '../components/SelectionBar';
import { ColumnsMenu } from '../components/ColumnsMenu';
import { RatingDialog } from '../components/RatingDialog';
import { FolderColorDialog } from '../components/FolderColorDialog';
import { FolderPicker } from '../components/FolderPicker';
import { getDomain, plural, truncateTitle } from '../lib/utils';
import { hiddenFolderIds, type FolderColor } from '../lib/folder_prefs';
import { HISTORY_COLUMNS, openedAt, compareOptional, type SortOrder } from '../lib/list_columns';
import { moveNodes, undoMoves, type MoveResult } from '../lib/bulk_move';
import { undoRename, type RenameResult } from '../lib/rename';
import { buildDiagnostics, type FeedbackDiagnostics } from '../lib/feedback';
import { FeedbackDialog } from '../components/FeedbackDialog';
import { AIOrganiseDialog } from '../components/AIOrganiseDialog';
import { AIChangesView } from '../components/AIChangesView';
import { useChangeSets } from './hooks/useChangeSets';
import { AgentsView } from '../components/AgentsView';
import { useBridge } from './hooks/useBridge';
import { useConnector } from './hooks/useConnector';
import { useAskAI } from './hooks/useAskAI';
import { AskAIView } from '../components/AskAIView';
import { AIToolsTabs, type AIToolsTab, type SettingsTab } from '../components/AIToolsTabs';

/** Bookmark and folder counts for feedback diagnostics (numbers only). */
function countTree(roots: chrome.bookmarks.BookmarkTreeNode[]): { bookmarks: number; folders: number } {
    let bookmarks = 0;
    let folders = 0;
    const walk = (n: chrome.bookmarks.BookmarkTreeNode) => {
        if (n.url) { bookmarks++; return; }
        if (n.parentId) folders++;
        n.children?.forEach(walk);
    };
    roots.forEach(walk);
    return { bookmarks, folders };
}

type Node = chrome.bookmarks.BookmarkTreeNode;
type Panel = 'bookmarks' | 'ai-settings' | 'trash' | 'ai-changes' | 'agents' | 'ask-ai';

// An incognito page talks to the incognito worker, which cannot write Trash.
const IS_INCOGNITO_PAGE = typeof chrome !== 'undefined' && chrome.extension?.inIncognitoContext === true;

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function App() {
    // ── Settings ──────────────────────────────────────────────────────────────
    const {
        useIncognito, theme, captureDelay, setCaptureDelay, useActiveTabCapture,
        handleToggleIncognito, handleToggleTheme, handleSetTheme,
        onCaptureDelayCommit, onToggleActiveTabCapture,
        sidebarHidden, setSidebarHidden, reloadSettings,
        listColumns, setListColumns, trashExternal, setTrashExternal,
    } = useSettings();

    const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(() =>
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    );
    useEffect(() => {
        if (theme !== 'system') {
            setEffectiveTheme(theme);
            return;
        }
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setEffectiveTheme(e.matches ? 'dark' : 'light');
        setEffectiveTheme(mq.matches ? 'dark' : 'light');
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme]);

    // ── Layout: docked folder panel on desktop, drawer on phones ─────────────
    const isNarrow = useMediaQuery(NARROW_QUERY);
    const [drawerOpen, setDrawerOpen] = useState(false); // session only, never synced
    const foldersOpen = isNarrow ? drawerOpen : !sidebarHidden;
    const toggleFolders = () => {
        if (isNarrow) setDrawerOpen(o => !o);
        else setSidebarHidden(!sidebarHidden);
    };

    // ── Toast ─────────────────────────────────────────────────────────────────
    const toast = useToast();

    // ── Folder prefs (colours, hidden from search) ────────────────────────────
    const folderPrefs = useFolderPrefs();
    const hiddenIds = useMemo(() => hiddenFolderIds(folderPrefs.prefs), [folderPrefs.prefs]);

    // ── Bookmark tree & navigation ────────────────────────────────────────────
    const {
        bookmarkTree, selectedFolderId, currentFolder,
        searchQuery, setSearchQuery, searchResults, hiddenResultCount, showHiddenResults,
        handleNavigate, handleNavigateBack, refreshTree, refreshCurrentFolder,
    } = useBookmarkTree(hiddenIds);

    // ── Thumbnail state & capture orchestration ───────────────────────────────
    const { thumbnails, loadingUrls, queuedUrls, triggerCapture, stopCapture, reloadThumbnails } = useThumbnails(
        currentFolder, useActiveTabCapture
    );

    const isCapturing = loadingUrls.size > 0 || queuedUrls.size > 0;

    // ── Panel routing ─────────────────────────────────────────────────────────
    const [activePanel, setActivePanel] = useState<Panel>('bookmarks');
    // Incrementing this causes useAITagger to re-check availability after settings save
    const [aiSettingsVersion, setAISettingsVersion] = useState(0);
    // AI Tools (owner, 2026-11-10): one page whose tabs are Ask AI, the settings tabs,
    // Connect Claude or ChatGPT and AI changes. The settings tabs share one panel.
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings');
    const openPanel = (panel: Panel) => {
        if (panel === 'ai-settings') setSettingsTab('settings');
        setActivePanel(panel);
        setDrawerOpen(false);
        // Another tab may have changed the Trash setting since this page loaded.
        if (panel === 'trash') reloadSettings();
    };
    const openFolder = (id: string) => {
        handleNavigate(id);
        openPanel('bookmarks');
    };

    // ── Focus after delete / Undo ─────────────────────────────────────────────
    // A deleted tile's neighbour (or a restored tile) gets focus once it renders.
    const focusRequest = useRef<{ id: string; until: number } | null>(null);
    const requestFocus = (id: string) => { focusRequest.current = { id, until: Date.now() + 4000 }; };
    useEffect(() => {
        const req = focusRequest.current;
        if (!req) return;
        if (Date.now() > req.until) { focusRequest.current = null; return; }
        const id = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(req.id) : req.id.replace(/["\\]/g, '\\$&');
        const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"] .tile-link`);
        if (el) {
            el.focus();
            focusRequest.current = null;
        }
    });

    // ── Trash ─────────────────────────────────────────────────────────────────
    const trash = useTrash({
        toast,
        onOpenFolder: openFolder,
        onOpenTrash: () => openPanel('trash'),
        onRestoredFocus: requestFocus,
        readOnly: IS_INCOGNITO_PAGE,
    });
    const canDelete = !IS_INCOGNITO_PAGE;

    // ── AI changes (D18) ──────────────────────────────────────────────────────
    const changeSets = useChangeSets(!IS_INCOGNITO_PAGE);
    const [aiDialog, setAIDialog] = useState<'export' | 'import' | null>(null);
    const [aiSetId, setAISetId] = useState<string | null>(null);
    const openAIChanges = (id: string | null = null) => { setAISetId(id); openPanel('ai-changes'); };
    const bridgeApi = useBridge();
    const connector = useConnector(!IS_INCOGNITO_PAGE);
    const askAI = useAskAI(!IS_INCOGNITO_PAGE);
    // The Ask AI side panel beside the bookmarks (owner, 2026-11-10), remembered for this session.
    const [askDock, setAskDock] = useState(() => { try { return sessionStorage.getItem('ask_dock') === '1'; } catch { return false; } });
    const toggleAskDock = (open = !askDock) => {
        setAskDock(open);
        try { sessionStorage.setItem('ask_dock', open ? '1' : '0'); } catch { /* storage blocked */ }
    };
    const openAITab = (tab: AIToolsTab) => {
        if (tab === 'settings' || tab === 'autotag' || tab === 'search' || tab === 'duplicates') { openPanel('ai-settings'); setSettingsTab(tab); }
        else if (tab === 'ask') openPanel('ask-ai');
        else if (tab === 'connect') openPanel('agents');
        else openAIChanges(null);
    };
    const aiTabBar = (active: AIToolsTab) => <AIToolsTabs active={active} onSelect={openAITab} pendingCount={changeSets.pendingCount} />;

    // ── AI auto-tagging ───────────────────────────────────────────────────────
    const {
        isTagging, taggingProgress,
        tags: aiTags,
    } = useAITagger(currentFolder, aiSettingsVersion);
    const storageWarning = useStorageWarning(isCapturing);

    // ── Folder connect ────────────────────────────────────────────────────────
    const handleConnectFolder = async () => {
        try {
            const { fsAccess } = await import('../lib/fsaccess');
            const result = await fsAccess.chooseDirectory();
            if (result.success) {
                const relinked = result.count > 0 ? ` Re-linked ${plural(result.count, 'existing preview')}.` : '';
                toast.show({ message: `Folder connected. New previews are saved to disk.${relinked}`, tone: 'success' });
            }
        } catch (err) {
            console.error('Failed to connect folder:', err);
            toast.show({ message: "Couldn't connect the folder. Try again.", tone: 'error' });
        }
    };

    // User-initiated captures check storage first; auto-capture (in useThumbnails) does not
    const handleBatchCapture = (urls: string[]) => {
        if (storageWarning.level === 'critical') {
            toast.show({
                message: 'Storage is full. Connect a folder to keep capturing previews.',
                tone: 'error',
                actions: [{ label: 'Connect folder', onClick: () => { void handleConnectFolder(); } }],
            });
            return;
        }
        triggerCapture(urls);
    };

    // ── Clipboard ─────────────────────────────────────────────────────────────
    const { clipboard, handleCut, handleCopy, handlePaste } = useClipboard(
        selectedFolderId, refreshTree, refreshCurrentFolder,
        (result) => showMoveResult(result),
    );

    // ── View / display state (pure UI, no effects) ────────────────────────────
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [filterType, setFilterType] = useState<'all' | 'folders' | 'bookmarks'>('all');
    const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc');
    const [activeTag, setActiveTag] = useState<string | null>(null);

    // Items in view before sorting (sorting by rating or visits needs their data).
    const filteredNodes = useMemo(() => {
        let nodes: Node[] =
            searchQuery.length > 2 ? searchResults : (currentFolder?.children ?? []);
        if (filterType === 'folders') nodes = nodes.filter(n => !n.url);
        else if (filterType === 'bookmarks') nodes = nodes.filter(n => n.url);
        // Tag filter: show only bookmarks that carry the active tag (folders hidden)
        if (activeTag) nodes = nodes.filter(n => n.url && (aiTags[n.url] ?? []).includes(activeTag));
        return nodes;
    }, [currentFolder, searchResults, searchQuery, filterType, activeTag, aiTags]);
    const viewUrls = useMemo(() => filteredNodes.map(n => n.url).filter((u): u is string => !!u), [filteredNodes]);

    // ── Ratings, "opened" times and history counts for the links in view ─────
    const linkMeta = useLinkMeta(viewUrls);
    const wantsHistory = (viewMode === 'list' && listColumns.some(c => HISTORY_COLUMNS.includes(c))) || sortOrder === 'visits-high';
    const history = useHistoryStats(viewUrls, wantsHistory);

    const displayedNodes = useMemo(() => {
        const opened = (n: Node) => n.url ? openedAt((n as Node & { dateLastUsed?: number }).dateLastUsed, linkMeta.meta[n.url]?.lastOpenedAt) : undefined;
        return [...filteredNodes].sort((a, b) => {
            const aF = !a.url, bF = !b.url;
            if (sortOrder.startsWith('name') || sortOrder.startsWith('domain')) {
                if (aF && !bF) return -1;
                if (!aF && bF) return 1;
            }
            switch (sortOrder) {
                case 'name-asc': return a.title.localeCompare(b.title);
                case 'name-desc': return b.title.localeCompare(a.title);
                case 'date-newest': return (b.dateAdded || 0) - (a.dateAdded || 0);
                case 'date-oldest': return (a.dateAdded || 0) - (b.dateAdded || 0);
                case 'domain-asc': {
                    if (aF) return a.title.localeCompare(b.title);
                    const dA = getDomain(a.url), dB = getDomain(b.url);
                    return dA === dB ? a.title.localeCompare(b.title) : dA.localeCompare(dB);
                }
                case 'domain-desc': {
                    if (aF) return b.title.localeCompare(a.title);
                    const dA = getDomain(a.url), dB = getDomain(b.url);
                    return dA === dB ? b.title.localeCompare(a.title) : dB.localeCompare(dA);
                }
                // Missing values sort last; ties by title.
                case 'opened-newest':
                    return compareOptional(opened(a), opened(b), true) || a.title.localeCompare(b.title);
                case 'rating-high':
                    return compareOptional(a.url ? linkMeta.meta[a.url]?.rating : undefined, b.url ? linkMeta.meta[b.url]?.rating : undefined, true)
                        || a.title.localeCompare(b.title);
                case 'visits-high':
                    return compareOptional(a.url ? history.stats[a.url]?.visits : undefined, b.url ? history.stats[b.url]?.visits : undefined, true)
                        || a.title.localeCompare(b.title);
                default: return 0;
            }
        });
    }, [filteredNodes, sortOrder, linkMeta.meta, history.stats]);

    // ── Selection (multi-select) ──────────────────────────────────────────────
    const displayedIds = useMemo(() => displayedNodes.map(n => n.id), [displayedNodes]);
    const viewKey = `${activePanel}|${selectedFolderId}|${searchQuery}|${filterType}|${sortOrder}|${activeTag ?? ''}`;
    const selection = useSelection(displayedIds, viewKey);
    const selectedNodes = displayedNodes.filter(n => selection.isSelected(n.id));

    // Tags present across the currently displayed nodes — drives the filter pills
    const availableTags = useMemo(() => {
        const tagSet = new Set<string>();
        const base = searchQuery.length > 2 ? searchResults : (currentFolder?.children ?? []);
        base.forEach(n => { if (n.url) (aiTags[n.url] ?? []).forEach(t => tagSet.add(t)); });
        return Array.from(tagSet).sort();
    }, [currentFolder, searchResults, searchQuery, aiTags]);

    // ── Delete (always through Trash, with Undo) ──────────────────────────────
    const deleteNodes = (targets: DeleteTarget[]) => {
        // Focus moves to the next item (or the previous one when it was last).
        const idx = displayedNodes.findIndex(n => n.id === targets[0]?.id);
        const neighbour = idx >= 0 ? (displayedNodes[idx + 1] ?? displayedNodes[idx - 1]) : undefined;
        void trash.deleteItems(targets, {
            onDeleted: () => { if (neighbour && !targets.some(t => t.id === neighbour.id)) requestFocus(neighbour.id); },
        });
    };
    const handleDeleteNode = (node: { id: string; title: string }) => deleteNodes([{ id: node.id, title: node.title }]);

    // ── Bulk actions on the selection ─────────────────────────────────────────
    const [bulkBusy, setBulkBusy] = useState<'move' | 'delete' | null>(null);
    const [movePicker, setMovePicker] = useState(false);

    const bulkDelete = async () => {
        const targets = selectedNodes
            .filter(n => n.parentId && n.parentId !== '0')
            .map(n => ({ id: n.id, title: n.title }));
        if (targets.length === 0) return;
        const lastIdx = Math.max(...targets.map(t => displayedNodes.findIndex(n => n.id === t.id)));
        const ids = new Set(targets.map(t => t.id));
        const next = displayedNodes.slice(lastIdx + 1).find(n => !ids.has(n.id))
            ?? [...displayedNodes].reverse().find(n => !ids.has(n.id));
        setBulkBusy('delete');
        const res = await trash.deleteItems(targets, {
            onDeleted: () => { if (next) requestFocus(next.id); },
        });
        setBulkBusy(null);
        if (res?.ok) selection.clear();
    };

    // Folders found by search come without their children: read those once selected.
    const [folderLinks, setFolderLinks] = useState<Record<string, string[]>>({});
    const bareFolderKey = selectedNodes.filter(n => !n.url && !n.children).map(n => n.id).sort().join(',');
    useEffect(() => {
        if (!bareFolderKey) return;
        let cancelled = false;
        const ids = bareFolderKey.split(',');
        Promise.all(ids.map(id => chrome.bookmarks.getChildren(id).then(kids => [id, kids.filter(k => k.url).map(k => k.url!)] as const).catch(() => [id, []] as const)))
            .then(pairs => { if (!cancelled) setFolderLinks(prev => ({ ...prev, ...Object.fromEntries(pairs) })); });
        return () => { cancelled = true; };
    }, [bareFolderKey]);

    // Links a bulk Open would open: selected bookmarks, plus bookmarks directly in selected folders.
    const bulkOpenUrls = (() => {
        const urls: string[] = [];
        for (const n of selectedNodes) {
            if (n.url) urls.push(n.url);
            else if (n.children) { for (const c of n.children) if (c.url) urls.push(c.url); }
            else urls.push(...(folderLinks[n.id] ?? []));
        }
        return [...new Set(urls)];
    })();

    const bulkOpen = async () => {
        // Read folders' current contents at the moment of opening (they may have changed).
        const urls: string[] = [];
        for (const n of selectedNodes) {
            if (n.url) { urls.push(n.url); continue; }
            const kids = await chrome.bookmarks.getChildren(n.id).catch(() => [] as Node[]);
            for (const k of kids) if (k.url) urls.push(k.url);
        }
        const unique = [...new Set(urls)];
        for (const url of unique) chrome.tabs.create({ url, active: false });
        linkMeta.markOpened(unique);
        toast.show({ message: `Opened ${plural(unique.length, 'tab')} in the background.` });
    };

    const bulkMove = async (targetId: string) => {
        const ids = selectedNodes.map(n => n.id);
        setMovePicker(false);
        setBulkBusy('move');
        let result: Awaited<ReturnType<typeof moveNodes>>;
        try {
            result = await moveNodes(ids, targetId);
        } catch (err) {
            console.error('[Move] failed', err);
            setBulkBusy(null);
            toast.show({ message: "Couldn't move the items. Nothing was changed.", tone: 'error' });
            return;
        }
        setBulkBusy(null);
        if (result.failed.length) selection.keepOnly(result.failed.map(f => f.id)); else selection.clear();
        showMoveResult(result);
    };

    // Result of Move to… or Cut and Paste, with Undo (DECISIONS D14, D15).
    // Synchronous, so an older result can't replace a newer toast.
    function showMoveResult(result: MoveResult) {
        const where = result.targetTitle !== undefined ? `'${truncateTitle(result.targetTitle || 'Untitled folder')}'` : 'the folder';
        const { moved, failed } = result;
        if (moved.length === 0) {
            toast.show({ message: `Nothing was moved. ${failed[0]?.reason ?? ''}`.trim(), tone: 'error' });
            return;
        }
        const undo = async () => {
            const id = toast.show({ message: 'Moving back…', busy: true, autoHideMs: 0 });
            const r = await undoMoves(moved);
            refreshTree();
            if (currentFolder?.id) refreshCurrentFolder(currentFolder.id);
            const notes = [
                r.changed ? `${plural(r.changed, 'item')} moved again since, so left where ${r.changed === 1 ? 'it is' : 'they are'}.` : '',
                r.missing ? `${r.missing} couldn't be moved back.` : '',
            ].filter(Boolean).join(' ');
            toast.replace(id, {
                message: notes ? `Moved ${r.restored} back. ${notes}` : `Moved ${plural(r.restored, 'item')} back.`,
                tone: notes ? 'error' : 'success',
            });
        };
        const name = moved.length === 1 && failed.length === 0 ? `'${truncateTitle(moved[0].title || 'Untitled')}'` : plural(moved.length, 'item');
        const message = failed.length
            ? `Moved ${moved.length} of ${moved.length + failed.length} to ${where}. ${failed.length} couldn't be moved.`
            : `Moved ${name} to ${where}.`;
        toast.show({
            message,
            tone: failed.length ? 'error' : 'success',
            actions: [{ label: 'Undo', onClick: () => { void undo(); }, primary: true }],
            onUndo: () => { void undo(); },
        });
    }

    // Rename from the menu, with Undo that never overwrites a newer name.
    const showRenameResult = (result: RenameResult) => {
        if (!result.ok) {
            toast.show({ message: `Couldn't rename it. ${result.reason}`, tone: 'error' });
            return;
        }
        const { record } = result;
        const undo = async () => {
            // Replacing the toast first removes its Undo, so a second click can't run it again.
            const id = toast.show({ message: 'Changing the name back…', busy: true, autoHideMs: 0 });
            const r = await undoRename(record);
            refreshTree();
            if (currentFolder?.id) refreshCurrentFolder(currentFolder.id);
            toast.replace(id,
                r === 'restored' ? { message: `Name changed back to '${truncateTitle(record.before || 'Untitled')}'.`, tone: 'success' }
                    : r === 'changed' ? { message: 'It was renamed again since, so its name was left as it is.', tone: 'error' }
                        : { message: "It no longer exists, so there's nothing to change back.", tone: 'error' },
            );
        };
        toast.show({
            message: `Renamed to '${truncateTitle(record.after || 'Untitled')}'.`,
            tone: 'success',
            actions: [{ label: 'Undo', onClick: () => { void undo(); }, primary: true }],
            onUndo: () => { void undo(); },
        });
    };

    // Keyboard: Ctrl/Cmd+A selects everything in view, Escape leaves selection mode.
    const { selectAll: selectAllInView, clear: clearSelection, active: selectionActive } = selection;
    useEffect(() => {
        if (activePanel !== 'bookmarks') return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
                && !(t instanceof HTMLInputElement && t.type === 'checkbox');
            if (typing || e.defaultPrevented) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
                if (document.querySelector('[role="dialog"]')) return;
                e.preventDefault();
                selectAllInView();
            } else if (e.key === 'Escape' && selectionActive && !document.querySelector('[role="dialog"], .context-menu')) {
                clearSelection();
                document.querySelector<HTMLElement>('.select-toggle')?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [activePanel, selectionActive, selectAllInView, clearSelection]);

    // ── Rating and folder colour dialogs ──────────────────────────────────────
    const [ratingFor, setRatingFor] = useState<{ url: string; title: string } | null>(null);
    const [ratingBusy, setRatingBusy] = useState(false);
    const saveRating = async (rating: number | null) => {
        if (!ratingFor) return;
        setRatingBusy(true);
        try {
            await linkMeta.setRating(ratingFor.url, rating);
            setRatingFor(null);
        } catch (err) {
            console.error('[Rating] save failed', err);
            toast.show({ message: "Couldn't save the rating. Try again.", tone: 'error' });
        } finally {
            setRatingBusy(false);
        }
    };

    const [colorFor, setColorFor] = useState<{ id: string; title: string } | null>(null);
    const [colorBusy, setColorBusy] = useState(false);
    const saveColor = async (color: FolderColor | null) => {
        if (!colorFor) return;
        setColorBusy(true);
        const ok = await folderPrefs.update([colorFor.id], { color });
        setColorBusy(false);
        if (ok) setColorFor(null);
        else toast.show({ message: "Couldn't save the colour. Try again.", tone: 'error' });
    };

    const setHidden = async (folder: { id: string; title: string }, hidden: boolean) => {
        const ok = await folderPrefs.update([folder.id], { hideFromSearch: hidden });
        const name = `'${truncateTitle(folder.title || 'Untitled folder')}'`;
        if (!ok) { toast.show({ message: "Couldn't save that. Try again.", tone: 'error' }); return; }
        toast.show({
            message: hidden ? `${name} and its subfolders are hidden from search on this device.` : `${name} shows in search again.`,
            actions: [{ label: 'Undo', onClick: () => { void folderPrefs.update([folder.id], { hideFromSearch: !hidden }); } }],
        });
    };

    // ── Context menu ──────────────────────────────────────────────────────────
    const { contextMenu, handleContextMenu, closeContextMenu, menuItems } = useContextMenu({
        selectedFolderId,
        currentFolderId: currentFolder?.id,
        refreshTree,
        refreshCurrentFolder,
        onTriggerCapture: handleBatchCapture,
        clipboard,
        onCut: handleCut,
        onCopy: handleCopy,
        onPaste: handlePaste,
        onDelete: handleDeleteNode,
        canDelete,
        folderPrefs: folderPrefs.prefs,
        onEditColor: (f) => setColorFor(f),
        onSetHidden: (f, hidden) => { void setHidden(f, hidden); },
        onOpened: (urls) => linkMeta.markOpened(urls),
        onRenamed: showRenameResult,
    });

    // ── Thumbnail update (manual regenerate / resume) ─────────────────────────
    const handleUpdateThumbnails = async (force = false, regenerateFailed = false) => {
        if (!displayedNodes.length) return;
        if (regenerateFailed) {
            const allMeta = await import('../lib/storage_index').then(m => m.storageIndex.getAll());
            const failedUrls = new Set(
                Object.values(allMeta).filter(r => r.status === 'error').map(r => r.url)
            );
            const urls = displayedNodes.map(n => n.url).filter((u): u is string => !!u && failedUrls.has(u));
            if (!urls.length) { toast.show({ message: 'No failed previews in this view.' }); return; }
            if (confirm(`Found ${urls.length} failed thumbnails. Regenerate them?`)) handleBatchCapture(urls);
        } else {
            const urls = displayedNodes.map(n => n.url).filter((u): u is string => !!u && (force || !thumbnails[u]));
            if (!urls.length) { if (force) toast.show({ message: 'No bookmarks to regenerate in this view.' }); return; }
            if (force) {
                if (confirm(`Regenerate ${urls.length} thumbnails? This might take a while.`)) handleBatchCapture(urls);
            } else {
                handleBatchCapture(urls);
            }
        }
    };

    // ── Backup ────────────────────────────────────────────────────────────────
    const handleExportBackup = async () => {
        try {
            downloadBlob(await backupManager.createBackup(), `bookmarks_thumbnails_backup_${Date.now()}.json`);
        } catch (err) {
            console.error('Export failed:', err);
            toast.show({ message: "Couldn't create the backup. Try again.", tone: 'error' });
        }
    };

    const handleExportSettings = async () => {
        try {
            downloadBlob(await backupManager.createSettingsBackup(), `bookmarks_thumbnails_settings_${Date.now()}.json`);
            toast.show({ message: 'Settings exported. The file has no previews and no API key.', tone: 'success' });
        } catch (err) {
            console.error('Settings export failed:', err);
            toast.show({ message: "Couldn't export settings. Try again.", tone: 'error' });
        }
    };

    const handleImportBackup = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const id = toast.show({ message: 'Importing…', busy: true, autoHideMs: 0 });
            try {
                const r = await backupManager.importBackup(file);
                const parts: string[] = [];
                if (r.kind === 'full') parts.push(`Imported ${plural(r.count, 'preview')} and ${plural(r.settingsApplied, 'setting')}`);
                else parts.push(`Imported ${plural(r.settingsApplied, 'setting')}`);
                if (r.settingsSkipped) parts[0] += `, skipped ${r.settingsSkipped}`;
                let message = `${parts[0]}.`;
                if (r.aiProviderHeld) message += ' The AI provider and server in the file were not applied: choose them yourself in Provider Settings.';
                toast.replace(id, {
                    message,
                    tone: 'success',
                    actions: r.aiProviderHeld ? [{ label: 'Provider Settings', onClick: () => openPanel('ai-settings') }] : [],
                    autoHideMs: r.aiProviderHeld ? 0 : 8000,
                });
                // Apply without a page reload.
                reloadSettings();
                reloadThumbnails();
                refreshTree();
                setAISettingsVersion(v => v + 1);
            } catch (err) {
                console.error('Import failed:', err);
                const message = err instanceof BackupFormatError || (err instanceof Error && /Unsupported backup version/.test(err.message))
                    ? err.message
                    : "Couldn't import that file. Nothing was changed.";
                toast.replace(id, { message, tone: 'error' });
            }
        };
        input.click();
    };

    const handleUninstall = async () => {
        if (!confirm('This will export a backup of your data and then uninstall the extension. Continue?')) return;

        try {
            downloadBlob(await backupManager.createBackup(), `bookmarks_thumbnails_backup_${Date.now()}.json`);
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            console.error('Backup failed during uninstall', e);
            if (!confirm('Backup failed! Proceed with uninstall anyway? All data will be lost.')) return;
        }
        if (chrome.management?.uninstallSelf) {
            chrome.management.uninstallSelf({ showConfirmDialog: true });
        } else {
            alert('Uninstall API not available. Please remove the extension manually from chrome://extensions');
        }
    };

    // ── Welcome modal ─────────────────────────────────────────────────────────
    const [showWelcome, setShowWelcome] = useState(false);
    // Diagnostics are counted once, when the form opens (not on every render).
    const [feedbackDiagnostics, setFeedbackDiagnostics] = useState<FeedbackDiagnostics | null>(null);
    useEffect(() => {
        chrome.storage.local.get('hasSeenWelcome', (result) => {
            if (!result.hasSeenWelcome) setShowWelcome(true);
        });
    }, []);
    const handleCloseWelcome = () => {
        chrome.storage.local.set({ hasSeenWelcome: true });
        setShowWelcome(false);
    };

    // ── Render ────────────────────────────────────────────────────────────────
    const sidebarProps = {
        folders: bookmarkTree,
        selectedFolderId,
        onSelectFolder: (id: string) => openFolder(id),
        onContextMenu: handleContextMenu,
        onTrash: () => openPanel('trash'),
        isTrashActive: activePanel === 'trash',
        trashCount: trash.badgeCount,
        folderPrefs: folderPrefs.prefs,
    };

    const folderColors = Object.fromEntries(Object.entries(folderPrefs.prefs).map(([id, p]) => [id, p.color]));
    const showSelectionBar = activePanel === 'bookmarks' && selection.active;

    return (
        <div className={`app-container theme-${effectiveTheme} ${showSelectionBar ? 'has-selection-bar' : ''}`}>
            <TopBar
                onSearch={(q) => { setSearchQuery(q); if (activePanel !== 'bookmarks' && q) setActivePanel('bookmarks'); }}
                searchQuery={searchQuery}
                onConnectFolder={handleConnectFolder}
                useIncognito={useIncognito}
                onToggleIncognito={handleToggleIncognito}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                filterType={filterType}
                onFilterChange={setFilterType}
                sortOrder={sortOrder}
                onSortChange={setSortOrder}
                onUpdateThumbnails={handleUpdateThumbnails}
                onStopCapture={stopCapture}
                isCapturing={isCapturing}
                onExportBackup={handleExportBackup}
                onExportSettings={handleExportSettings}
                onImportBackup={handleImportBackup}
                onUninstall={handleUninstall}
                theme={theme}
                onToggleTheme={handleToggleTheme}
                captureDelay={captureDelay}
                onCaptureDelayChange={setCaptureDelay}
                onCaptureDelayCommit={onCaptureDelayCommit}
                useActiveTabCapture={useActiveTabCapture}
                onToggleActiveTabCapture={onToggleActiveTabCapture}
                isTagging={isTagging}
                taggingProgress={taggingProgress}
                availableTags={availableTags}
                activeTag={activeTag}
                onTagChange={setActiveTag}
                onOpenFeedback={() => setFeedbackDiagnostics(buildDiagnostics({ ...countTree(bookmarkTree), view: viewMode }))}
                onAISettings={() => openPanel('ai-settings')}
                isAISettingsActive={activePanel === 'ai-settings'}
                onToggleFolders={toggleFolders}
                foldersOpen={foldersOpen}
                onOpenTrash={() => openPanel('trash')}
                onAskAI={() => { if (activePanel === 'ask-ai') openPanel('bookmarks'); toggleAskDock(activePanel === 'ask-ai' ? true : undefined); }}
                isAskAIActive={askDock && activePanel !== 'ask-ai'}
                onAITools={() => openPanel('ask-ai')}
                aiPendingCount={changeSets.pendingCount}
                trashCount={trash.badgeCount}
                onToggleSelect={() => { if (selection.active) selection.clear(); else { openPanel('bookmarks'); selection.start(); } }}
                selecting={showSelectionBar}
                canSortByVisits={history.permission === 'granted'}
            />

            {storageWarning.level !== 'none' && (
                <div className={`storage-warning ${storageWarning.level}`} role="status">
                    {storageWarning.message}
                    {storageWarning.level === 'critical' && (
                        <button onClick={handleConnectFolder} className="connect-folder-btn-inline">
                            Connect Folder
                        </button>
                    )}
                </div>
            )}

            <div className="content-wrapper">
                {!isNarrow && !sidebarHidden && <Sidebar {...sidebarProps} />}
                {isNarrow && drawerOpen && (
                    <Sidebar {...sidebarProps} variant="drawer" onClose={() => setDrawerOpen(false)} />
                )}
                {activePanel === 'ai-settings' ? (
                    <AISettingsPage
                        onBack={() => openPanel('bookmarks')}
                        // Bump the version so useAITagger re-checks availability, but
                        // stay on the page — saving shows "Saved!" without navigating.
                        onSave={() => setAISettingsVersion(v => v + 1)}
                        currentFolder={currentFolder}
                        onDeleteBookmarks={(targets) => trash.deleteItems(targets, { origin: 'duplicate-finder' })}
                        canDelete={canDelete}
                        hiddenFolderIds={hiddenIds}
                        tab={settingsTab}
                        onTab={openAITab}
                        pendingCount={changeSets.pendingCount}
                    />
                ) : activePanel === 'ask-ai' ? (
                    <AskAIView
                        api={askAI}
                        onBack={() => openPanel('bookmarks')}
                        tabBar={aiTabBar('ask')}
                        onOpenSettings={() => openPanel('ai-settings')}
                        onOpenConnect={() => openPanel('agents')}
                        onOpenActivity={() => openAIChanges(null)}
                        onCopyPaste={() => setAIDialog('export')}
                        readOnly={IS_INCOGNITO_PAGE}
                        toast={(message, tone) => toast.show({ message, tone: tone === 'error' ? 'error' : 'success' })}
                    />
                ) : activePanel === 'agents' ? (
                    <AgentsView
                        connector={connector}
                        api={bridgeApi}
                        roots={bookmarkTree}
                        hiddenFolderIds={hiddenIds}
                        onBack={() => openPanel('bookmarks')}
                        tabBar={aiTabBar('connect')}
                        readOnly={IS_INCOGNITO_PAGE}
                        toast={(message, tone) => toast.show({ message, tone: tone === 'error' ? 'error' : 'success' })}
                    />
                ) : activePanel === 'ai-changes' ? (
                    <AIChangesView
                        api={changeSets}
                        roots={bookmarkTree}
                        selectedId={aiSetId}
                        onSelect={setAISetId}
                        onBack={() => openPanel('bookmarks')}
                        tabBar={aiTabBar('changes')}
                        onOrganise={() => setAIDialog('export')}
                        onAskAI={() => openPanel('ask-ai')}
                        onImport={() => setAIDialog('import')}
                        readOnly={IS_INCOGNITO_PAGE}
                        toast={(message, tone) => toast.show({ message, tone: tone === 'error' ? 'error' : 'success' })}
                    />
                ) : activePanel === 'trash' ? (
                    <TrashView
                        trash={trash}
                        roots={bookmarkTree}
                        onBack={() => openPanel('bookmarks')}
                        keepExternal={trashExternal}
                        onKeepExternalChange={(v) => {
                            void setTrashExternal(v).then(ok => {
                                if (!ok) toast.show({ message: "Couldn't save that setting. Try again.", tone: 'error' });
                            });
                        }}
                    />
                ) : (
                    <MainContent
                        folder={currentFolder}
                        displayedNodes={displayedNodes}
                        isSearching={searchQuery.length > 2}
                        searchQuery={searchQuery}
                        thumbnails={thumbnails}
                        loadingUrls={loadingUrls}
                        queuedUrls={queuedUrls}
                        bookmarkTags={aiTags}
                        onNavigate={handleNavigate}
                        onNavigateBack={handleNavigateBack}
                        viewMode={viewMode}
                        onContextMenu={handleContextMenu}
                        onDelete={(node) => handleDeleteNode(node)}
                        canDelete={canDelete}
                        pendingDeleteIds={trash.pendingIds}
                        trashCount={trash.badgeCount}
                        onOpenTrash={() => openPanel('trash')}
                        folderPrefs={folderPrefs.prefs}
                        selection={selection}
                        selectionBar={(
                            <SelectionBar
                                count={selection.count}
                                total={displayedNodes.length}
                                openCount={bulkOpenUrls.length}
                                canDelete={canDelete}
                                busy={bulkBusy}
                                onOpen={() => { void bulkOpen(); }}
                                onMove={() => setMovePicker(true)}
                                onDelete={() => { void bulkDelete(); }}
                                onSelectAll={selection.selectAll}
                                onDone={() => { selection.clear(); document.querySelector<HTMLElement>('.select-toggle')?.focus(); }}
                            />
                        )}
                        columnsMenu={(
                            <ColumnsMenu
                                columns={listColumns}
                                onChange={setListColumns}
                                permission={history.permission}
                                onRequestHistory={history.request}
                                onReleaseHistory={() => { void history.release(); }}
                                historyError={history.error}
                            />
                        )}
                        listColumns={viewMode === 'list' ? listColumns.filter(c => !HISTORY_COLUMNS.includes(c) || history.permission === 'granted') : []}
                        linkMeta={linkMeta.meta}
                        historyStats={history.stats}
                        historyLoading={history.loading}
                        onRate={(node) => { if (node.url) setRatingFor({ url: node.url, title: node.title || node.url }); }}
                        onOpened={(url) => linkMeta.markOpened([url])}
                        hiddenResultCount={hiddenResultCount}
                        onShowHidden={showHiddenResults}
                    />
                )}
                {askDock && activePanel !== 'ask-ai' && (
                    <AskAIView
                        api={askAI}
                        variant="dock"
                        onBack={() => toggleAskDock(false)}
                        onOpenSettings={() => openPanel('ai-settings')}
                        onOpenConnect={() => openPanel('agents')}
                        onOpenActivity={() => openAIChanges(null)}
                        onCopyPaste={() => setAIDialog('export')}
                        readOnly={IS_INCOGNITO_PAGE}
                        toast={(message, tone) => toast.show({ message, tone: tone === 'error' ? 'error' : 'success' })}
                    />
                )}
            </div>

            {contextMenu.visible && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={menuItems}
                    onClose={closeContextMenu}
                />
            )}

            {movePicker && (
                <FolderPicker
                    roots={bookmarkTree}
                    subject={selection.count === 1 ? `'${truncateTitle(selectedNodes[0]?.title || 'Untitled')}'` : plural(selection.count, 'item')}
                    busy={bulkBusy === 'move'}
                    onCancel={() => setMovePicker(false)}
                    onPick={(id) => { void bulkMove(id); }}
                    title="Move to…"
                    actionLabel="Move here"
                    exclude={new Set(selectedNodes.filter(n => !n.url).map(n => n.id))}
                    colors={folderColors}
                />
            )}

            {ratingFor && (
                <RatingDialog
                    title={ratingFor.title}
                    current={linkMeta.meta[ratingFor.url]?.rating}
                    busy={ratingBusy}
                    onCancel={() => setRatingFor(null)}
                    onSave={(r) => { void saveRating(r); }}
                />
            )}

            {colorFor && (
                <FolderColorDialog
                    folderTitle={truncateTitle(colorFor.title || 'Untitled folder')}
                    current={folderPrefs.prefs[colorFor.id]?.color}
                    busy={colorBusy}
                    onCancel={() => setColorFor(null)}
                    onSave={(c) => { void saveColor(c); }}
                />
            )}

            {aiDialog && (
                <AIOrganiseDialog
                    roots={bookmarkTree}
                    hiddenFolderIds={hiddenIds}
                    api={changeSets}
                    startAt={aiDialog}
                    onClose={() => setAIDialog(null)}
                    onImported={(id) => { setAIDialog(null); openAIChanges(id); }}
                />
            )}

            {feedbackDiagnostics && (
                <FeedbackDialog
                    onClose={() => setFeedbackDiagnostics(null)}
                    diagnostics={feedbackDiagnostics}
                />
            )}

            {showWelcome && (
                <WelcomeModal onClose={handleCloseWelcome} theme={theme} onSetTheme={handleSetTheme} />
            )}

            <Toast toast={toast.toast} onDismiss={toast.dismiss} />
        </div>
    );
}

export default App;
