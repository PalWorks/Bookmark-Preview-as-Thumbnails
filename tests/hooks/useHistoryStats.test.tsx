// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useHistoryStats } from '../../src/popup/hooks/useHistoryStats';
import { ColumnsMenu } from '../../src/components/ColumnsMenu';

let granted = false;
const added = new Set<() => void>();
const removed = new Set<() => void>();
const getVisits = vi.fn(async ({ url }: { url: string }) => url.includes('popular')
    ? [{ visitTime: 100 }, { visitTime: 300 }, { visitTime: 200 }]
    : []);

beforeEach(() => {
    granted = false;
    added.clear(); removed.clear();
    const c = globalThis.chrome as unknown as Record<string, unknown>;
    c.permissions = {
        contains: vi.fn(async () => granted),
        request: vi.fn(async () => { granted = true; added.forEach(f => f()); return true; }),
        remove: vi.fn(async () => { granted = false; removed.forEach(f => f()); return true; }),
        onAdded: { addListener: (f: () => void) => added.add(f), removeListener: (f: () => void) => added.delete(f) },
        onRemoved: { addListener: (f: () => void) => removed.add(f), removeListener: (f: () => void) => removed.delete(f) },
    };
    c.history = { getVisits };
    getVisits.mockClear();
});
afterEach(() => cleanup());

describe('useHistoryStats', () => {
    it('reads nothing until permission is granted, then counts visits per link', async () => {
        const urls = ['https://popular.example/', 'https://never.example/'];
        const { result } = renderHook(() => useHistoryStats(urls, true));
        await waitFor(() => expect(result.current.permission).toBe('not-granted'));
        expect(getVisits).not.toHaveBeenCalled();
        await act(async () => { await result.current.request(); });
        await waitFor(() => expect(result.current.stats['https://popular.example/']).toEqual({ visits: 3, lastVisit: 300 }));
        expect(result.current.stats['https://never.example/']).toEqual({ visits: 0, lastVisit: undefined });
    });

    it('a permission removed in Chrome hides the data', async () => {
        granted = true;
        const { result } = renderHook(() => useHistoryStats(['https://popular.example/'], true));
        await waitFor(() => expect(result.current.stats['https://popular.example/']?.visits).toBe(3));
        await act(async () => { granted = false; removed.forEach(f => f()); });
        await waitFor(() => expect(result.current.permission).toBe('not-granted'));
        expect(result.current.stats).toEqual({});
    });
});

describe('ColumnsMenu', () => {
    it('asks Chrome before turning on a history column; declining keeps it off', async () => {
        const onChange = vi.fn();
        const onRequest = vi.fn(async () => false);
        render(<ColumnsMenu columns={['added']} onChange={onChange} permission="not-granted"
            onRequestHistory={onRequest} onReleaseHistory={() => { }} historyError={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Visits' }));
        await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
        await screen.findByText(/Chrome didn't allow history access/);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Rating' }));
        expect(onChange).toHaveBeenCalledWith(['added', 'rating']);
    });
});
