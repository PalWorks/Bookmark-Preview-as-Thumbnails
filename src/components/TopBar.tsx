import React from 'react';
import { Search } from 'lucide-react';
import './TopBar.css';

interface TopBarProps {
    onSearch: (query: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onSearch }) => {
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
                {/* Placeholder for future actions like "Add Bookmark" */}
            </div>
        </div>
    );
};
