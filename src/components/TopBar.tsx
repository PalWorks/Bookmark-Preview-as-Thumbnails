import React, { useState, useRef, useEffect } from 'react';
import { Search, Settings, FolderOpen, Eye, EyeOff, Info, Filter, ArrowUpDown, LayoutGrid, List, Download, Upload, Trash2, Clock } from 'lucide-react';
import './TopBar.css';

interface TopBarProps {
    onSearch: (query: string) => void;
    onConnectFolder: () => void;
    useIncognito: boolean;
    onToggleIncognito: (value: boolean) => void;
    viewMode: 'grid' | 'list';
    onViewModeChange: (mode: 'grid' | 'list') => void;
    filterType: 'all' | 'folders' | 'bookmarks';
    onFilterChange: (type: 'all' | 'folders' | 'bookmarks') => void;
    sortOrder: 'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest' | 'domain-asc' | 'domain-desc';
    onSortChange: (order: 'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest' | 'domain-asc' | 'domain-desc') => void;
    onUpdateThumbnails: (force?: boolean) => void;
    onStopCapture: () => void;
    isCapturing: boolean;
    onExportBackup: () => void;
    onImportBackup: () => void;
    onUninstall: () => void;
    theme: 'light' | 'dark' | 'system';
    onToggleTheme: () => void;
    captureDelay: number;
    onCaptureDelayChange: (value: number) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
    onSearch,
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
    onCaptureDelayChange
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
                <span className="logo-text">Bookmarks Preview As Thumbnails</span>
            </div>

            <div className="actions-section">
                <div className="search-input-wrapper">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search bookmarks"
                        className="search-input"
                        onChange={(e) => onSearch(e.target.value)}
                    />
                </div>

                <div className="capture-controls-wrapper">
                    <span className="capture-label">Generate Preview</span>
                    <div className="capture-buttons">
                        <button
                            className={`icon-btn start-btn ${isCapturing ? 'capturing' : ''}`}
                            onClick={(e) => onUpdateThumbnails(e.shiftKey)}
                            title="Generate thumbnail preview for URLs (Shift+Click to force regenerate)"
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
                        className={`action-btn ${isFilterOpen ? 'active' : ''} ${filterType !== 'all' ? 'has-value' : ''}`}
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        title="Filter By"
                    >
                        <Filter size={18} />
                        <span>{getFilterLabel()}</span>
                    </button>
                    {isFilterOpen && (
                        <div className="dropdown-menu">
                            <div className={`dropdown-item ${filterType === 'all' ? 'selected' : ''}`} onClick={() => { onFilterChange('all'); setIsFilterOpen(false); }}>All</div>
                            <div className={`dropdown-item ${filterType === 'folders' ? 'selected' : ''}`} onClick={() => { onFilterChange('folders'); setIsFilterOpen(false); }}>Folders Only</div>
                            <div className={`dropdown-item ${filterType === 'bookmarks' ? 'selected' : ''}`} onClick={() => { onFilterChange('bookmarks'); setIsFilterOpen(false); }}>Bookmarks Only</div>
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
                        className="icon-btn"
                        onClick={onToggleTheme}
                        title={`Theme: ${getThemeIconTitle()}`}
                        style={{ marginRight: '4px' }}
                    >
                        <img src="/icons/DarkThemeIcon.svg" alt="Toggle Theme" style={{ width: '20px', height: '20px', filter: 'brightness(0) invert(1)' }} />
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

                            <div className="menu-item" onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                                <Clock size={16} className="menu-icon" />
                                <div className="menu-text">
                                    <div className="menu-title">Screen Capture Delay</div>
                                    <div className="menu-desc">Wait time (ms)</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <input
                                        type="number"
                                        className="delay-input"
                                        value={captureDelay}
                                        onChange={(e) => onCaptureDelayChange(parseInt(e.target.value) || 0)}
                                        min="100"
                                        step="50"
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

                            <div className="menu-item" onClick={() => {
                                onUninstall();
                                setIsMenuOpen(false);
                            }}>
                                <Trash2 size={16} className="menu-icon" style={{ color: '#d93025' }} />
                                <div>
                                    <div className="menu-title" style={{ color: '#d93025' }}>Uninstall Extension</div>
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
