import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { backupManager } from '../lib/backup_manager';
import { Sidebar } from '../components/Sidebar';
import { MainContent } from '../components/MainContent';
import { TopBar } from '../components/TopBar';
import { ContextMenu } from '../components/ContextMenu';
import { WelcomeModal } from '../components/WelcomeModal';
import { useSettings } from './hooks/useSettings';
import { useBookmarkTree } from './hooks/useBookmarkTree';
import { useStorageWarning } from './hooks/useStorageWarning';
import { useClipboard } from './hooks/useClipboard';
import { useThumbnails } from './hooks/useThumbnails';
import { useContextMenu } from './hooks/useContextMenu';
import { getDomain } from '../lib/utils';

function App() {
    // ── Settings ──────────────────────────────────────────────────────────────
    const {
        useIncognito, theme, captureDelay, setCaptureDelay, useActiveTabCapture,
        handleToggleIncognito, handleToggleTheme, handleSetTheme,
        onCaptureDelayCommit, onToggleActiveTabCapture,
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

    // ── Bookmark tree & navigation ────────────────────────────────────────────
    const {
        bookmarkTree, selectedFolderId, currentFolder,
        searchQuery, setSearchQuery, searchResults,
        handleNavigate, handleNavigateBack, refreshTree, refreshCurrentFolder,
    } = useBookmarkTree();

    // ── Thumbnail state & capture orchestration ───────────────────────────────
    const { thumbnails, loadingUrls, queuedUrls, triggerCapture, stopCapture } = useThumbnails(
        currentFolder, useActiveTabCapture
    );

    const isCapturing = loadingUrls.size > 0 || queuedUrls.size > 0;
    const storageWarning = useStorageWarning(isCapturing);

    // User-initiated captures check storage first; auto-capture (in useThumbnails) does not
    const handleBatchCapture = (urls: string[]) => {
        if (storageWarning.level === 'critical') {
            alert('Storage is full! Please connect a folder to continue capturing thumbnails.');
            return;
        }
        triggerCapture(urls);
    };

    // ── Clipboard ─────────────────────────────────────────────────────────────
    const { clipboard, handleCut, handleCopy, handlePaste } = useClipboard(
        selectedFolderId, refreshTree, refreshCurrentFolder
    );

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
    });

    // ── View / display state (pure UI, no effects) ────────────────────────────
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [filterType, setFilterType] = useState<'all' | 'folders' | 'bookmarks'>('all');
    const [sortOrder, setSortOrder] = useState<
        'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest' | 'domain-asc' | 'domain-desc'
    >('name-asc');

    const displayedNodes = useMemo(() => {
        let nodes: chrome.bookmarks.BookmarkTreeNode[] =
            searchQuery.length > 2 ? searchResults : (currentFolder?.children ?? []);
        if (filterType === 'folders') nodes = nodes.filter(n => !n.url);
        else if (filterType === 'bookmarks') nodes = nodes.filter(n => n.url);
        return [...nodes].sort((a, b) => {
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
                default: return 0;
            }
        });
    }, [currentFolder, searchResults, searchQuery, filterType, sortOrder]);

    // ── Thumbnail update (manual regenerate / resume) ─────────────────────────
    const handleUpdateThumbnails = async (force = false, regenerateFailed = false) => {
        if (!displayedNodes.length) return;
        if (regenerateFailed) {
            const allMeta = await import('../lib/storage_index').then(m => m.storageIndex.getAll());
            const failedUrls = new Set(
                Object.values(allMeta).filter(r => r.status === 'error').map(r => r.url)
            );
            const urls = displayedNodes.map(n => n.url).filter((u): u is string => !!u && failedUrls.has(u));
            if (!urls.length) { alert('No failed thumbnails found in the current view.'); return; }
            if (confirm(`Found ${urls.length} failed thumbnails. Regenerate them?`)) handleBatchCapture(urls);
        } else {
            const urls = displayedNodes.map(n => n.url).filter((u): u is string => !!u && (force || !thumbnails[u]));
            if (!urls.length) { if (force) alert('No bookmarks found to regenerate in the current view.'); return; }
            if (force) {
                if (confirm(`Regenerate ${urls.length} thumbnails? This might take a while.`)) handleBatchCapture(urls);
            } else {
                handleBatchCapture(urls);
            }
        }
    };

    // ── Folder connect & backup ───────────────────────────────────────────────
    const handleConnectFolder = async () => {
        try {
            const { fsAccess } = await import('../lib/fsaccess');
            const result = await fsAccess.chooseDirectory();
            if (result.success) {
                let msg = 'Folder connected successfully! Future thumbnails will be saved to disk.';
                if (result.count > 0) msg += `\n\nFound and re-linked ${result.count} existing thumbnails from this folder.`;
                alert(msg);
            }
        } catch (err) {
            console.error('Failed to connect folder:', err);
            alert('Failed to connect folder. Please try again.');
        }
    };

    const handleExportBackup = async () => {
        try {
            const blob = await backupManager.createBackup();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookmarks_thumbnails_backup_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Failed to create backup.');
        }
    };

    const handleImportBackup = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const result = await backupManager.importBackup(file);
                alert(`Successfully imported ${result.count} thumbnails.`);
                window.location.reload();
            } catch (err) {
                console.error('Import failed:', err);
                alert('Failed to import backup. Invalid file?');
            }
        };
        input.click();
    };

    const handleUninstall = async () => {
        if (!confirm('This will export a backup of your data and then uninstall the extension. Continue?')) return;

        try {
            const blob = await backupManager.createBackup();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookmarks_thumbnails_backup_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
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
    return (
        <div className={`app-container theme-${effectiveTheme}`}>
            <TopBar
                onSearch={setSearchQuery}
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
                onImportBackup={handleImportBackup}
                onUninstall={handleUninstall}
                theme={theme}
                onToggleTheme={handleToggleTheme}
                captureDelay={captureDelay}
                onCaptureDelayChange={setCaptureDelay}
                onCaptureDelayCommit={onCaptureDelayCommit}
                useActiveTabCapture={useActiveTabCapture}
                onToggleActiveTabCapture={onToggleActiveTabCapture}
            />

            {storageWarning.level !== 'none' && (
                <div className={`storage-warning ${storageWarning.level}`}>
                    {storageWarning.message}
                    {storageWarning.level === 'critical' && (
                        <button onClick={handleConnectFolder} className="connect-folder-btn-inline">
                            Connect Folder
                        </button>
                    )}
                </div>
            )}

            <div className="content-wrapper">
                <Sidebar
                    folders={bookmarkTree}
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={handleNavigate}
                    onContextMenu={handleContextMenu}
                />
                <MainContent
                    folder={currentFolder}
                    displayedNodes={displayedNodes}
                    isSearching={searchQuery.length > 2}
                    searchQuery={searchQuery}
                    thumbnails={thumbnails}
                    loadingUrls={loadingUrls}
                    queuedUrls={queuedUrls}
                    onNavigate={handleNavigate}
                    onNavigateBack={handleNavigateBack}
                    onTriggerBatchCapture={handleBatchCapture}
                    viewMode={viewMode}
                    onContextMenu={handleContextMenu}
                />
            </div>

            {contextMenu.visible && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={menuItems}
                    onClose={closeContextMenu}
                />
            )}

            {showWelcome && (
                <WelcomeModal onClose={handleCloseWelcome} theme={theme} onSetTheme={handleSetTheme} />
            )}
        </div>
    );
}

export default App;
