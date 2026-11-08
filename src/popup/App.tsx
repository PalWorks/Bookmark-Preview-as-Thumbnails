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
import { moveNodes, undoMoves } from '../lib/bulk_move';

type Node = chrome.bookmarks.BookmarkTreeNode;
type Panel = 'bookmarks' | 'ai-settings' | 'trash';

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
    const openPanel = (panel: Panel) => {
        setActivePanel(panel);
        setDrawerOpen(false);
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

    // ── AI auto-tagging ───────────────────────────────────────────────────────
    const {
        aiAvailability, isTagging, taggingProgress,
        tags: aiTags, triggerAutoTag, stopAutoTag,
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
        selectedFolderId, refreshTree, refreshCurrentFolder
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

    // Links a bulk Open would open: selected bookmarks, plus bookmarks directly in selected folders.
    const bulkOpenUrls = (() => {
        const urls: string[] = [];
        for (const n of selectedNodes) {
            if (n.url) urls.push(n.url);
            else for (const c of n.children ?? []) if (c.url) urls.push(c.url);
        }
        return [...new Set(urls)];
    })();

    const bulkOpen = () => {
        for (const url of bulkOpenUrls) chrome.tabs.create({ url, active: false });
        linkMeta.markOpened(bulkOpenUrls);
        toast.show({ message: `Opened ${plural(bulkOpenUrls.length, 'tab')} in the background.` });
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
        const target = (await chrome.bookmarks.get(targetId).catch(() => []))[0];
        const where = target ? `'${truncateTitle(target.title || 'Untitled folder')}'` : 'the folder';
        const { moved, failed } = result;
        if (failed.length) selection.keepOnly(failed.map(f => f.id)); else selection.clear();
        if (moved.length === 0) {
            toast.show({ message: `Nothing was moved. ${failed[0]?.reason ?? ''}`.trim(), tone: 'error' });
            return;
        }
        const undo = async () => {
            const id = toast.show({ message: 'Moving back…', busy: true, autoHideMs: 0 });
            const r = await undoMoves(moved);
            toast.replace(id, {
                message: r.missing ? `Moved ${r.restored} back. ${r.missing} couldn't be moved back.` : `Moved ${plural(r.restored, 'item')} back.`,
                tone: r.missing ? 'error' : 'success',
            });
        };
        const message = failed.length
            ? `Moved ${moved.length} of ${moved.length + failed.length} to ${where}. ${failed.length} couldn't be moved.`
            : `Moved ${plural(moved.length, 'item')} to ${where}.`;
        toast.show({
            message,
            tone: failed.length ? 'error' : 'success',
            actions: [{ label: 'Undo', onClick: () => { void undo(); }, primary: true }],
            onUndo: () => { void undo(); },
        });
    };

    // Keyboard: Ctrl/Cmd+A selects everything in view, Escape leaves selection mode.
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
                selection.selectAll();
            } else if (e.key === 'Escape' && selection.active && !document.querySelector('[role="dialog"], .context-menu')) {
                selection.clear();
                document.querySelector<HTMLElement>('.select-toggle')?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [activePanel, selection]);

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
    });

    // ── AI auto-tag: tag all bookmarks in the current view ───────────────────
    const handleAutoTag = () => {
        const bookmarks = displayedNodes
            .filter(n => n.url)
            .map(n => ({ url: n.url!, title: n.title }));
        if (bookmarks.length === 0) return;
        triggerAutoTag(bookmarks);
    };

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
                if (r.aiProviderHeld) message += ' AI provider not changed because an API key is saved. Review it in AI Settings.';
                toast.replace(id, {
                    message,
                    tone: 'success',
                    actions: r.aiProviderHeld ? [{ label: 'AI Settings', onClick: () => openPanel('ai-settings') }] : [],
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
        onAISettings: () => openPanel('ai-settings'),
        isAISettingsActive: activePanel === 'ai-settings',
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
                aiAvailability={aiAvailability}
                isTagging={isTagging}
                taggingProgress={taggingProgress}
                availableTags={availableTags}
                activeTag={activeTag}
                onTagChange={setActiveTag}
                onAutoTag={handleAutoTag}
                onStopTag={stopAutoTag}
                onAISettings={() => openPanel('ai-settings')}
                isAISettingsActive={activePanel === 'ai-settings'}
                onToggleFolders={toggleFolders}
                foldersOpen={foldersOpen}
                onOpenTrash={() => openPanel('trash')}
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
                                onOpen={bulkOpen}
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

            {showWelcome && (
                <WelcomeModal onClose={handleCloseWelcome} theme={theme} onSetTheme={handleSetTheme} />
            )}

            <Toast toast={toast.toast} onDismiss={toast.dismiss} />
        </div>
    );
}

export default App;
