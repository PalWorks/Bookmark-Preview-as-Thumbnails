// SPDX-License-Identifier: AGPL-3.0-only
// One "AI Tools" page (owner, 2026-11-10): Ask AI first, then the settings tabs, then
// Connect Claude or ChatGPT and AI changes. Each tab is its own view; this bar ties them together.
import React, { useEffect, useRef } from 'react';
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
    { id: 'changes', label: 'AI Changes', Icon: Clock },
];

// Arrow keys move to the next tab and open it. Each tab is its own view, so the bar is
// mounted again; this flag tells the new bar to take focus on its active tab.
let focusAfterSwitch = false;

export const AIToolsTabs: React.FC<{ active: AIToolsTab; onSelect: (t: AIToolsTab) => void; pendingCount?: number }> = ({ active, onSelect, pendingCount = 0 }) => {
    const barRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!focusAfterSwitch) return;
        focusAfterSwitch = false;
        barRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }, [active]);
    const onKeyDown = (e: React.KeyboardEvent) => {
        // Alt+Left is the browser's Back; leave key combinations alone.
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const i = TABS.findIndex(t => t.id === active);
        const go = (n: number) => { e.preventDefault(); focusAfterSwitch = true; onSelect(TABS[(n + TABS.length) % TABS.length].id); };
        switch (e.key) {
            case 'ArrowRight': return go(i + 1);
            case 'ArrowLeft': return go(i - 1);
            case 'Home': return go(0);
            case 'End': return go(TABS.length - 1);
        }
    };
    return (
        <div className="ai-tabs ai-tools-tabs" role="tablist" aria-label="AI Tools" ref={barRef} onKeyDown={onKeyDown}>
            {TABS.map(({ id, label, Icon }) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active === id}
                    // One tab stop for the bar; the arrow keys move within it.
                    tabIndex={active === id ? 0 : -1}
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
};
