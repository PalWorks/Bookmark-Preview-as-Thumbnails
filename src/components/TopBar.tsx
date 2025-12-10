import React from 'react';
import { Search, Settings } from 'lucide-react';
import './TopBar.css';

interface TopBarProps {
    onSearch: (query: string) => void;
    onConnectFolder: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onSearch, onConnectFolder }) => {
    return (
        <div className="top-bar">
            <div className="logo-section">
                <span className="logo-text">Bookmarks</span>
            </div>
            <div className="search-section">
                <div className="search-input-wrapper">
                    <Search size={20} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search bookmarks"
                        className="search-input"
                        onChange={(e) => onSearch(e.target.value)}
                    />
                </div>
            </div>
            <div className="actions-section">
                <button className="icon-btn" onClick={onConnectFolder} title="Connect Local Folder for Storage">
                    <Settings size={20} />
                </button>
            </div>
        </div>
    );
};
