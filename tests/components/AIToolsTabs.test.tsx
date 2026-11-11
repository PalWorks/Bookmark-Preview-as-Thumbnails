// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AIToolsTabs, type AIToolsTab } from '../../src/components/AIToolsTabs';

afterEach(() => cleanup());

// Each tab is its own view in the app, so the bar is mounted again on every switch.
const Harness = () => {
    const [tab, setTab] = useState<AIToolsTab>('ask');
    return <div key={tab}><AIToolsTabs active={tab} onSelect={setTab} /></div>;
};

describe('AI Tools tabs', () => {
    it('one tab stop; arrow keys open the next tab and keep focus on it', () => {
        render(<Harness />);
        const ask = screen.getByRole('tab', { name: 'Ask AI' });
        expect(ask.tabIndex).toBe(0);
        expect(screen.getByRole('tab', { name: 'Provider Settings' }).tabIndex).toBe(-1);
        ask.focus();
        fireEvent.keyDown(ask, { key: 'ArrowRight' });
        const settings = screen.getByRole('tab', { name: 'Provider Settings' });
        expect(settings.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(settings);
        fireEvent.keyDown(settings, { key: 'ArrowLeft' });
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        expect(document.activeElement?.textContent).toBe('AI Changes');
    });
});
