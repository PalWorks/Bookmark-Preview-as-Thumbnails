// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState, useRef, useEffect } from 'react';
import { Search, Settings, FolderOpen, Eye, EyeOff, Info, Filter, ArrowUpDown, LayoutGrid, List, Download, Upload, Trash2, Clock, MessageSquare, Star, Sparkles, PanelLeft, SlidersHorizontal } from 'lucide-react';
import './TopBar.css';
import { SIDEBAR_ID } from './Sidebar';

interface TopBarProps {
    onSearch: (query: string) => void;
    searchQuery: string;
    onConnectFolder: () => void;
    useIncognito: boolean;
    onToggleIncognito: (value: boolean) => void;
    viewMode: 'grid' | 'list';
    onViewModeChange: (mode: 'grid' | 'list') => void;
    filterType: 'all' | 'folders' | 'bookmarks';
    onFilterChange: (type: 'all' | 'folders' | 'bookmarks') => void;
    sortOrder: 'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest' | 'domain-asc' | 'domain-desc';
    onSortChange: (order: 'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest' | 'domain-asc' | 'domain-desc') => void;
    onUpdateThumbnails: (force?: boolean, regenerateFailed?: boolean) => void;
    onStopCapture: () => void;
    isCapturing: boolean;
    onExportBackup: () => void;
    onImportBackup: () => void;
    onUninstall: () => void;
    theme: 'light' | 'dark' | 'system';
    onToggleTheme: () => void;
    captureDelay: number;
    onCaptureDelayChange: (value: number) => void;
    onCaptureDelayCommit: (value: number) => void;
    useActiveTabCapture: boolean;
    onToggleActiveTabCapture: (value: boolean) => void;
    aiAvailability: 'checking' | 'available' | 'after-download' | 'unavailable' | 'unsupported';
    isTagging: boolean;
    taggingProgress: { done: number; total: number };
    availableTags: string[];
    activeTag: string | null;
    onTagChange: (tag: string | null) => void;
    onAutoTag: () => void;
    onStopTag: () => void;
    onAISettings: () => void;
    isAISettingsActive: boolean;
    /** Show or hide the folder panel (drawer on phones). */
    onToggleFolders: () => void;
    foldersOpen: boolean;
    onOpenTrash: () => void;
    trashCount: number;
    onExportSettings: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
    onSearch,
    searchQuery,
    onConnectFolder,
    useIncognito,
    onToggleIncognito,
    viewMode,
    onViewModeChange,
    filterType,
    onFilterChange,
    sortOrder,
    onSortChange,
    onUpdateThumbnails,
    onStopCapture,
    isCapturing,
    onExportBackup,
    onImportBackup,
    onUninstall,
    theme,
    onToggleTheme,
    captureDelay,
    onCaptureDelayChange,
    onCaptureDelayCommit,
    useActiveTabCapture,
    onToggleActiveTabCapture,
    aiAvailability,
    isTagging,
    taggingProgress,
    availableTags,
    activeTag,
    onTagChange,
    onAutoTag,
    onStopTag,
    onAISettings,
    isAISettingsActive,
    onToggleFolders,
    foldersOpen,
    onOpenTrash,
    trashCount,
    onExportSettings,
}) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isSortOpen, setIsSortOpen] = useState(false);

    const menuRef = useRef<HTMLDivElement>(null);
    const filterRef = useRef<HTMLDivElement>(null);
    const sortRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false);
            }
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
            if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
                setIsSortOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsMenuOpen(false);
            setIsFilterOpen(false);
            setIsSortOpen(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const getFilterLabel = () => {
        if (activeTag) return activeTag;
        switch (filterType) {
            case 'folders': return 'Folders';
            case 'bookmarks': return 'Bookmarks';
            default: return 'Filter By';
        }
    };

    const getSortLabel = () => {
        switch (sortOrder) {
            case 'name-asc': return 'Title (A-Z)';
            case 'name-desc': return 'Title (Z-A)';
            case 'date-newest': return 'Newest';
            case 'date-oldest': return 'Oldest';
            case 'domain-asc': return 'Domain (A-Z)';
            case 'domain-desc': return 'Domain (Z-A)';
            default: return 'Sort';
        }
    };

    const getThemeIconTitle = () => {
        switch (theme) {
            case 'light': return 'Light Mode';
            case 'dark': return 'Dark Mode';
            case 'system': return 'System Theme';
        }
    };

    const option = (selected: boolean, label: string, onClick: () => void) => (
        <button type="button" role="menuitemradio" aria-checked={selected}
            className={`dropdown-item ${selected ? 'selected' : ''}`} onClick={onClick}>
            {label}
        </button>
    );

    const aiDisabled = aiAvailability === 'unsupported' || aiAvailability === 'unavailable';

    return (
        <header className="top-bar">
            <button
                type="button"
                className={`folders-toggle ${foldersOpen ? 'folders-toggle--open' : ''}`}
                onClick={onToggleFolders}
                aria-expanded={foldersOpen}
                aria-controls={SIDEBAR_ID}
                title={foldersOpen ? 'Hide folders' : 'Show folders'}
            >
                <PanelLeft size={18} aria-hidden="true" />
                <span>Folders</span>
            </button>

            <div className="logo-section">
                <span className="logo-text logo-text--full">Visual Bookmark Manager with Thumbnail Previews</span>
                <span className="logo-text logo-text--short" aria-hidden="true">Bookmarks</span>
            </div>

            <div className="search-input-wrapper">
                <Search size={18} className="search-icon" aria-hidden="true" />
                <input
                    type="search"
                    placeholder="Search bookmarks"
                    aria-label="Search bookmarks"
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => onSearch(e.target.value)}
                    autoComplete="off"
                />
            </div>

            <div className="topbar-tools">
                <button
                    type="button"
                    className={`icon-btn topbar-ai-btn ${isAISettingsActive ? 'topbar-ai-btn--active' : ''}`}
                    onClick={onAISettings}
                    title="AI Settings"
                    aria-label="AI Settings"
                    aria-pressed={isAISettingsActive}
                >
                    <Sparkles size={18} aria-hidden="true" />
                </button>

                <div className="capture-controls-wrapper">
                    <span className="capture-label">Generate Preview</span>
                    <div className="capture-buttons">
                        <button
                            type="button"
                            className={`icon-btn start-btn ${isCapturing ? 'capturing' : ''}`}
                            onClick={(e) => onUpdateThumbnails(e.shiftKey, e.ctrlKey || e.metaKey)}
                            title="Generate thumbnail preview for URLs (Shift+Click to force regenerate all, Ctrl+Click to regenerate failed)"
                            aria-label="Generate previews"
                        >
                            <img src="/icons/PlayButton.svg" alt="" />
                        </button>
                        <button type="button" className="icon-btn stop-btn" onClick={onStopCapture} title="Stop generating thumbnail preview for URLs" aria-label="Stop generating previews">
                            <img src="/icons/StopButton.svg" alt="" />
                        </button>
                    </div>
                </div>

                <div className="dropdown-wrapper" ref={filterRef}>
                    <button
                        type="button"
                        className={`action-btn ${isFilterOpen ? 'active' : ''} ${filterType !== 'all' || activeTag ? 'has-value' : ''}`}
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        title="Filter By"
                        aria-label={`Filter: ${getFilterLabel()}`}
                        aria-haspopup="menu"
                        aria-expanded={isFilterOpen}
                    >
                        <Filter size={18} aria-hidden="true" />
                        <span>{getFilterLabel()}</span>
                    </button>
                    {isFilterOpen && (
                        <div className="dropdown-menu" role="menu">
                            {option(filterType === 'all' && !activeTag, 'All', () => { onFilterChange('all'); onTagChange(null); setIsFilterOpen(false); })}
                            {option(filterType === 'folders', 'Folders Only', () => { onFilterChange('folders'); onTagChange(null); setIsFilterOpen(false); })}
                            {option(filterType === 'bookmarks', 'Bookmarks Only', () => { onFilterChange('bookmarks'); onTagChange(null); setIsFilterOpen(false); })}
                            {availableTags.length > 0 && (
                                <>
                                    <div className="menu-divider"></div>
                                    <div className="dropdown-tag-label">By AI Tag</div>
                                    <div className="dropdown-tags">
                                        {availableTags.map(tag => (
                                            <button
                                                type="button"
                                                key={tag}
                                                aria-pressed={activeTag === tag}
                                                className={`dropdown-tag-pill ${activeTag === tag ? 'dropdown-tag-pill--active' : ''}`}
                                                onClick={() => { onTagChange(activeTag === tag ? null : tag); setIsFilterOpen(false); }}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="dropdown-wrapper" ref={sortRef}>
                    <button
                        type="button"
                        className={`action-btn ${isSortOpen ? 'active' : ''}`}
                        onClick={() => setIsSortOpen(!isSortOpen)}
                        title="Sort"
                        aria-label={`Sort: ${getSortLabel()}`}
                        aria-haspopup="menu"
                        aria-expanded={isSortOpen}
                    >
                        <ArrowUpDown size={18} aria-hidden="true" />
                        <span>{getSortLabel()}</span>
                    </button>
                    {isSortOpen && (
                        <div className="dropdown-menu" role="menu">
                            {option(sortOrder === 'name-asc', 'Title (A-Z)', () => { onSortChange('name-asc'); setIsSortOpen(false); })}
                            {option(sortOrder === 'name-desc', 'Title (Z-A)', () => { onSortChange('name-desc'); setIsSortOpen(false); })}
                            <div className="menu-divider"></div>
                            {option(sortOrder === 'domain-asc', 'Domain (A-Z)', () => { onSortChange('domain-asc'); setIsSortOpen(false); })}
                            {option(sortOrder === 'domain-desc', 'Domain (Z-A)', () => { onSortChange('domain-desc'); setIsSortOpen(false); })}
                            <div className="menu-divider"></div>
                            {option(sortOrder === 'date-newest', 'Date Added (Newest)', () => { onSortChange('date-newest'); setIsSortOpen(false); })}
                            {option(sortOrder === 'date-oldest', 'Date Added (Oldest)', () => { onSortChange('date-oldest'); setIsSortOpen(false); })}
                        </div>
                    )}
                </div>

                <div className="view-toggle" role="group" aria-label="View">
                    <button
                        type="button"
                        className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => onViewModeChange('grid')}
                        title="Grid View"
                        aria-label="Grid view"
                        aria-pressed={viewMode === 'grid'}
                    >
                        <LayoutGrid size={18} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                        onClick={() => onViewModeChange('list')}
                        title="List View"
                        aria-label="List view"
                        aria-pressed={viewMode === 'list'}
                    >
                        <List size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>

            <div className="settings-wrapper" ref={menuRef}>
                <button
                    type="button"
                    className="icon-btn theme-toggle-btn"
                    onClick={onToggleTheme}
                    title={`Theme: ${getThemeIconTitle()}`}
                    aria-label={`Theme: ${getThemeIconTitle()}. Change theme`}
                >
                    <img src="/icons/DarkThemeIcon.svg" alt="" className="theme-icon" />
                </button>
                <button
                    type="button"
                    className={`icon-btn ${isMenuOpen ? 'active' : ''}`}
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    title="Settings"
                    aria-label="Settings"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                >
                    <Settings size={20} aria-hidden="true" />
                </button>

                {isMenuOpen && (
                    <div className="settings-menu" role="menu">
                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            onOpenTrash();
                            setIsMenuOpen(false);
                        }}>
                            <Trash2 size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Trash{trashCount > 0 ? ` (${trashCount})` : ''}</div>
                                <div className="menu-desc">Restore deleted bookmarks</div>
                            </div>
                        </button>

                        <div className="menu-divider"></div>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            onConnectFolder();
                            setIsMenuOpen(false);
                        }}>
                            <FolderOpen size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Choose storage folder</div>
                                <div className="menu-desc">Store thumbnails locally</div>
                            </div>
                        </button>

                        <div className="menu-divider"></div>

                        <button type="button" role="menuitemcheckbox" aria-checked={useIncognito} className="menu-item toggle-item" onClick={(e) => {
                            e.stopPropagation();
                            onToggleIncognito(!useIncognito);
                        }}>
                            {useIncognito ? <EyeOff size={16} className="menu-icon" aria-hidden="true" /> : <Eye size={16} className="menu-icon" aria-hidden="true" />}
                            <div className="menu-text">
                                <div className="menu-title">Open in Incognito Window</div>
                                <div className="menu-desc">Re-opens extension in Incognito</div>
                            </div>
                            <div className={`toggle-switch ${useIncognito ? 'checked' : ''}`} aria-hidden="true"></div>
                        </button>

                        <div className="menu-info">
                            <Info size={14} className="info-icon" aria-hidden="true" />
                            <span>
                                Note: Incognito mode cannot capture sites that require login (e.g. Gmail, Notion).
                                You must also allow this extension in Incognito settings.
                            </span>
                        </div>

                        <div className="menu-divider"></div>

                        <button type="button" role="menuitemcheckbox" aria-checked={useActiveTabCapture} className="menu-item toggle-item" onClick={(e) => {
                            e.stopPropagation();
                            onToggleActiveTabCapture(!useActiveTabCapture);
                        }}>
                            <LayoutGrid size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Use Active Tab Capture</div>
                            </div>
                            <div className={`toggle-switch ${useActiveTabCapture ? 'checked' : ''}`} aria-hidden="true"></div>
                        </button>

                        <div className="menu-info">
                            <Info size={14} className="info-icon" aria-hidden="true" />
                            <span>
                                Experimental: Temporarily activates tabs to capture them.
                                Fixes issues on sites like Reddit/GitHub.
                            </span>
                        </div>

                        <div className="menu-divider"></div>

                        <div className="menu-item menu-item--static" onClick={(e) => e.stopPropagation()}>
                            <Clock size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <label className="menu-title" htmlFor="capture-delay-input">Screen Capture Delay</label>
                                <div className="menu-desc">Wait time (ms)</div>
                            </div>
                            <div className="delay-input-wrapper">
                                <input
                                    id="capture-delay-input"
                                    type="number"
                                    inputMode="numeric"
                                    className="delay-input"
                                    value={captureDelay}
                                    onChange={(e) => {
                                        const raw = parseInt(e.target.value, 10);
                                        const value = isNaN(raw) ? 0 : raw;
                                        onCaptureDelayChange(value);
                                        onCaptureDelayCommit(value);
                                    }}
                                    onBlur={(e) => {
                                        const raw = parseInt(e.target.value, 10);
                                        const clamped = isNaN(raw) || raw < 100 ? 500 : Math.min(30000, raw);
                                        onCaptureDelayChange(clamped);
                                        onCaptureDelayCommit(clamped);
                                    }}
                                    min="100"
                                    max="30000"
                                    step="100"
                                />
                            </div>
                        </div>

                        <div className="menu-divider"></div>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            onExportBackup();
                            setIsMenuOpen(false);
                        }}>
                            <Download size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Export Backup</div>
                                <div className="menu-desc">Settings and preview images</div>
                            </div>
                        </button>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            onExportSettings();
                            setIsMenuOpen(false);
                        }}>
                            <SlidersHorizontal size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Export Settings</div>
                                <div className="menu-desc">Small file, no images or API key</div>
                            </div>
                        </button>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            onImportBackup();
                            setIsMenuOpen(false);
                        }}>
                            <Upload size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Import Backup</div>
                                <div className="menu-desc">Restore a backup or settings file</div>
                            </div>
                        </button>

                        <div className="menu-divider"></div>

                        <button
                            type="button"
                            role="menuitem"
                            aria-disabled={aiDisabled}
                            className={`menu-item ${aiDisabled ? 'menu-item--disabled' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (aiDisabled) return;
                                if (isTagging) { onStopTag(); } else { onAutoTag(); setIsMenuOpen(false); }
                            }}
                        >
                            <Sparkles size={16} className="menu-icon menu-icon--ai" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">
                                    {isTagging
                                        ? `Auto-Tagging… (${taggingProgress.done}/${taggingProgress.total})`
                                        : 'Auto-Tag Bookmarks'}
                                </div>
                                <div className="menu-desc">
                                    {aiAvailability === 'checking' ? 'Checking AI availability…' :
                                     aiAvailability === 'unsupported' ? 'Chrome 127+ required' :
                                     aiAvailability === 'after-download' ? 'AI model downloading…' :
                                     aiAvailability === 'unavailable' ? 'AI not available' :
                                     isTagging ? 'Click to stop' : 'AI-powered topic tagging'}
                                </div>
                            </div>
                            {isTagging && <div className="ai-tag-spinner" aria-hidden="true"></div>}
                        </button>

                        <div className="menu-divider"></div>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            chrome.tabs.create({ url: 'mailto:support@palworks.ai?subject=Feedback%20-%20Bookmarks%20Preview%20As%20Thumbnails' });
                            setIsMenuOpen(false);
                        }}>
                            <MessageSquare size={16} className="menu-icon" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Submit Feedback</div>
                                <div className="menu-desc">Send us your thoughts</div>
                            </div>
                        </button>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/bookmarks-as-thumbnails/eedekafhclngkhhkcocblnllkbodgnhj/reviews' });
                            setIsMenuOpen(false);
                        }}>
                            <Star size={16} className="menu-icon menu-icon--accent" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title">Rate Extension</div>
                                <div className="menu-desc">Love it? Leave a review</div>
                            </div>
                        </button>

                        <div className="menu-divider"></div>

                        <button type="button" role="menuitem" className="menu-item" onClick={() => {
                            onUninstall();
                            setIsMenuOpen(false);
                        }}>
                            <Trash2 size={16} className="menu-icon menu-icon--danger" aria-hidden="true" />
                            <div className="menu-text">
                                <div className="menu-title menu-title--danger">Uninstall Extension</div>
                                <div className="menu-desc">Auto-backup & Remove</div>
                            </div>
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
};
