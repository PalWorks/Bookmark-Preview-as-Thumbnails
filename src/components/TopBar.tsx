import React, { useState, useRef, useEffect } from 'react';
import { Search, Settings, FolderOpen, Eye, EyeOff, Info, Filter, ArrowUpDown, LayoutGrid, List, Download, Upload, Trash2, Clock, MessageSquare, Star, Sparkles } from 'lucide-react';
import './TopBar.css';

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

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
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

    return (
        <div className="top-bar">
            <div className="logo-section">
                <span className="logo-text">Visual Bookmark Manager with Thumbnail Previews</span>
            </div>

            <div className="actions-section">
                <div className="search-input-wrapper">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search bookmarks"
                        className="search-input"
                        value={searchQuery}
                        onChange={(e) => onSearch(e.target.value)}
                    />
                </div>

                <button
                    className={`icon-btn topbar-ai-btn ${isAISettingsActive ? 'topbar-ai-btn--active' : ''}`}
                    onClick={onAISettings}
                    title="AI Settings"
                >
                    <Sparkles size={18} />
                </button>

                <div className="capture-controls-wrapper">
                    <span className="capture-label">Generate Preview</span>
                    <div className="capture-buttons">
                        <button
                            className={`icon-btn start-btn ${isCapturing ? 'capturing' : ''}`}
                            onClick={(e) => onUpdateThumbnails(e.shiftKey, e.ctrlKey || e.metaKey)}
                            title="Generate thumbnail preview for URLs (Shift+Click to force regenerate all, Ctrl+Click to regenerate failed)"
                        >
                            <img src="/icons/PlayButton.svg" alt="Start" />
                        </button>
                        <button className="icon-btn stop-btn" onClick={onStopCapture} title="Stop generating thumbnail preview for URLs">
                            <img src="/icons/StopButton.svg" alt="Stop" />
                        </button>
                    </div>
                </div>

                <div className="dropdown-wrapper" ref={filterRef}>
                    <button
                        className={`action-btn ${isFilterOpen ? 'active' : ''} ${filterType !== 'all' || activeTag ? 'has-value' : ''}`}
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        title="Filter By"
                    >
                        <Filter size={18} />
                        <span>{getFilterLabel()}</span>
                    </button>
                    {isFilterOpen && (
                        <div className="dropdown-menu">
                            <div className={`dropdown-item ${filterType === 'all' && !activeTag ? 'selected' : ''}`} onClick={() => { onFilterChange('all'); onTagChange(null); setIsFilterOpen(false); }}>All</div>
                            <div className={`dropdown-item ${filterType === 'folders' ? 'selected' : ''}`} onClick={() => { onFilterChange('folders'); onTagChange(null); setIsFilterOpen(false); }}>Folders Only</div>
                            <div className={`dropdown-item ${filterType === 'bookmarks' ? 'selected' : ''}`} onClick={() => { onFilterChange('bookmarks'); onTagChange(null); setIsFilterOpen(false); }}>Bookmarks Only</div>
                            {availableTags.length > 0 && (
                                <>
                                    <div className="menu-divider"></div>
                                    <div className="dropdown-tag-label">By AI Tag</div>
                                    <div className="dropdown-tags">
                                        {availableTags.map(tag => (
                                            <div
                                                key={tag}
                                                className={`dropdown-tag-pill ${activeTag === tag ? 'dropdown-tag-pill--active' : ''}`}
                                                onClick={() => { onTagChange(activeTag === tag ? null : tag); setIsFilterOpen(false); }}
                                            >
                                                {tag}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="dropdown-wrapper" ref={sortRef}>
                    <button
                        className={`action-btn ${isSortOpen ? 'active' : ''}`}
                        onClick={() => setIsSortOpen(!isSortOpen)}
                        title="Sort"
                    >
                        <ArrowUpDown size={18} />
                        <span>{getSortLabel()}</span>
                    </button>
                    {isSortOpen && (
                        <div className="dropdown-menu">
                            <div className={`dropdown-item ${sortOrder === 'name-asc' ? 'selected' : ''}`} onClick={() => { onSortChange('name-asc'); setIsSortOpen(false); }}>Title (A-Z)</div>
                            <div className={`dropdown-item ${sortOrder === 'name-desc' ? 'selected' : ''}`} onClick={() => { onSortChange('name-desc'); setIsSortOpen(false); }}>Title (Z-A)</div>
                            <div className="menu-divider"></div>
                            <div className={`dropdown-item ${sortOrder === 'domain-asc' ? 'selected' : ''}`} onClick={() => { onSortChange('domain-asc'); setIsSortOpen(false); }}>Domain (A-Z)</div>
                            <div className={`dropdown-item ${sortOrder === 'domain-desc' ? 'selected' : ''}`} onClick={() => { onSortChange('domain-desc'); setIsSortOpen(false); }}>Domain (Z-A)</div>
                            <div className="menu-divider"></div>
                            <div className={`dropdown-item ${sortOrder === 'date-newest' ? 'selected' : ''}`} onClick={() => { onSortChange('date-newest'); setIsSortOpen(false); }}>Date Added (Newest)</div>
                            <div className={`dropdown-item ${sortOrder === 'date-oldest' ? 'selected' : ''}`} onClick={() => { onSortChange('date-oldest'); setIsSortOpen(false); }}>Date Added (Oldest)</div>
                        </div>
                    )}
                </div>

                <div className="view-toggle">
                    <button
                        className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => onViewModeChange('grid')}
                        title="Grid View"
                    >
                        <LayoutGrid size={18} />
                    </button>
                    <button
                        className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                        onClick={() => onViewModeChange('list')}
                        title="List View"
                    >
                        <List size={18} />
                    </button>
                </div>

                <div className="settings-wrapper" ref={menuRef}>
                    <button
                        className="icon-btn theme-toggle-btn"
                        onClick={onToggleTheme}
                        title={`Theme: ${getThemeIconTitle()}`}
                    >
                        <img src="/icons/DarkThemeIcon.svg" alt="Toggle Theme" className="theme-icon" />
                    </button>
                    <button
                        className={`icon-btn ${isMenuOpen ? 'active' : ''}`}
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        title="Settings"
                    >
                        <Settings size={20} />
                    </button>

                    {isMenuOpen && (
                        <div className="settings-menu">
                            <div className="menu-item" onClick={() => {
                                onConnectFolder();
                                setIsMenuOpen(false);
                            }}>
                                <FolderOpen size={16} className="menu-icon" />
                                <div className="menu-text">
                                    <div className="menu-title">Choose storage folder</div>
                                    <div className="menu-desc">Store thumbnails locally</div>
                                </div>
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item toggle-item" onClick={(e) => {
                                e.stopPropagation();
                                onToggleIncognito(!useIncognito);
                            }}>
                                {useIncognito ? <EyeOff size={16} className="menu-icon" /> : <Eye size={16} className="menu-icon" />}
                                <div className="menu-text">
                                    <div className="menu-title">Open in Incognito Window</div>
                                    <div className="menu-desc">Re-opens extension in Incognito</div>
                                </div>
                                <div className={`toggle-switch ${useIncognito ? 'checked' : ''}`}></div>
                            </div>

                            <div className="menu-info">
                                <Info size={14} className="info-icon" />
                                <span>
                                    Note: Incognito mode cannot capture sites that require login (e.g. Gmail, Notion).
                                    You must also allow this extension in Incognito settings.
                                </span>
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item toggle-item" onClick={(e) => {
                                e.stopPropagation();
                                onToggleActiveTabCapture(!useActiveTabCapture);
                            }}>
                                <LayoutGrid size={16} className="menu-icon" />
                                <div className="menu-text">
                                    <div className="menu-title">Use Active Tab Capture</div>

                                </div>
                                <div className={`toggle-switch ${useActiveTabCapture ? 'checked' : ''}`}></div>
                            </div>

                            <div className="menu-info">
                                <Info size={14} className="info-icon" />
                                <span>
                                    Experimental: Temporarily activates tabs to capture them.
                                    Fixes issues on sites like Reddit/GitHub.
                                </span>
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item menu-item--static" onClick={(e) => e.stopPropagation()}>
                                <Clock size={16} className="menu-icon" />
                                <div className="menu-text">
                                    <div className="menu-title">Screen Capture Delay</div>
                                    <div className="menu-desc">Wait time (ms)</div>
                                </div>
                                <div className="delay-input-wrapper">
                                    <input
                                        type="number"
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

                            <div className="menu-item" onClick={() => {
                                onExportBackup();
                                setIsMenuOpen(false);
                            }}>
                                <Download size={16} className="menu-icon" />
                                <div className="menu-text">
                                    <div className="menu-title">Export Backup</div>
                                    <div className="menu-desc">Save settings & images</div>
                                </div>
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item" onClick={() => {
                                onImportBackup();
                                setIsMenuOpen(false);
                            }}>
                                <Upload size={16} className="menu-icon" />
                                <div>
                                    <div className="menu-title">Import Backup</div>
                                    <div className="menu-desc">Restore from file</div>
                                </div>
                            </div>

                            <div className="menu-divider"></div>

                            <div
                                className={`menu-item ${aiAvailability === 'unsupported' || aiAvailability === 'unavailable' ? 'menu-item--disabled' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (aiAvailability === 'unsupported' || aiAvailability === 'unavailable') return;
                                    if (isTagging) { onStopTag(); } else { onAutoTag(); setIsMenuOpen(false); }
                                }}
                            >
                                <Sparkles size={16} className="menu-icon menu-icon--ai" />
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
                                {isTagging && <div className="ai-tag-spinner"></div>}
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item" onClick={() => {
                                chrome.tabs.create({ url: 'mailto:support@palworks.ai?subject=Feedback%20-%20Bookmarks%20Preview%20As%20Thumbnails' });
                                setIsMenuOpen(false);
                            }}>
                                <MessageSquare size={16} className="menu-icon" />
                                <div className="menu-text">
                                    <div className="menu-title">Submit Feedback</div>
                                    <div className="menu-desc">Send us your thoughts</div>
                                </div>
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item" onClick={() => {
                                chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/bookmarks-as-thumbnails/eedekafhclngkhhkcocblnllkbodgnhj/reviews' });
                                setIsMenuOpen(false);
                            }}>
                                <Star size={16} className="menu-icon menu-icon--accent" />
                                <div className="menu-text">
                                    <div className="menu-title">Rate Extension</div>
                                    <div className="menu-desc">Love it? Leave a review</div>
                                </div>
                            </div>

                            <div className="menu-divider"></div>

                            <div className="menu-item" onClick={() => {
                                onUninstall();
                                setIsMenuOpen(false);
                            }}>
                                <Trash2 size={16} className="menu-icon menu-icon--danger" />
                                <div>
                                    <div className="menu-title menu-title--danger">Uninstall Extension</div>
                                    <div className="menu-desc">Auto-backup & Remove</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
