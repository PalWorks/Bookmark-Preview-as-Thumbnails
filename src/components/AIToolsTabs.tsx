// SPDX-License-Identifier: AGPL-3.0-only
// One "AI Tools" page (owner, 2026-11-10): Ask AI first, then the settings tabs, then
// Connect Claude or ChatGPT and AI changes. Each tab is its own view; this bar ties them together.
import React from 'react';
import { Bot, Clock, Copy, Plug, Search, Settings, Tag } from 'lucide-react';
import '../popup/components/AISettingsPage.css';

export type AIToolsTab = 'ask' | 'settings' | 'autotag' | 'search' | 'duplicates' | 'connect' | 'changes';
export type SettingsTab = Extract<AIToolsTab, 'settings' | 'autotag' | 'search' | 'duplicates'>;

const TABS: Array<{ id: AIToolsTab; label: string; Icon: typeof Bot }> = [
    { id: 'ask', label: 'Ask AI', Icon: Bot },
    { id: 'settings', label: 'Provider Settings', Icon: Settings },
    { id: 'autotag', label: 'Auto-Tag', Icon: Tag },
    { id: 'search', label: 'Smart Search', Icon: Search },
    { id: 'duplicates', label: 'Duplicate Finder', Icon: Copy },
    { id: 'connect', label: 'Connect Claude or ChatGPT', Icon: Plug },
    { id: 'changes', label: 'AI changes', Icon: Clock },
];

export const AIToolsTabs: React.FC<{ active: AIToolsTab; onSelect: (t: AIToolsTab) => void; pendingCount?: number }> = ({ active, onSelect, pendingCount = 0 }) => (
    <div className="ai-tabs ai-tools-tabs" role="tablist" aria-label="AI Tools">
        {TABS.map(({ id, label, Icon }) => (
            <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active === id}
                className={`ai-tab ${active === id ? 'ai-tab--active' : ''}`}
                onClick={() => onSelect(id)}
            >
                <Icon size={14} aria-hidden="true" />
                {label}
                {id === 'changes' && pendingCount > 0 && <span className="ai-tab-count" aria-label={`${pendingCount} to review`}>{pendingCount}</span>}
            </button>
        ))}
    </div>
);
