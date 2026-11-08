// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../../src/popup/hooks/useSelection';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('useSelection', () => {
    it('toggles, and Shift selects a range from the anchor in display order', () => {
        const { result } = renderHook(({ order, key }) => useSelection(order, key), { initialProps: { order: ids, key: 'v1' } });
        act(() => result.current.toggle('b'));
        act(() => result.current.range('d'));
        expect([...result.current.selected].sort()).toEqual(['b', 'c', 'd']);
        act(() => result.current.toggle('c'));
        expect([...result.current.selected].sort()).toEqual(['b', 'd']);
        expect(result.current.active).toBe(true);
    });

    it('a range uses the order at click time (after a re-sort)', () => {
        const { result, rerender } = renderHook(({ order, key }) => useSelection(order, key), { initialProps: { order: ids, key: 'v1' } });
        act(() => result.current.toggle('a'));
        rerender({ order: ['e', 'd', 'c', 'b', 'a'], key: 'v1' });
        act(() => result.current.range('c'));
        expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
    });

    it('without a usable anchor, Shift+click is a plain toggle', () => {
        const { result, rerender } = renderHook(({ order, key }) => useSelection(order, key), { initialProps: { order: ids, key: 'v1' } });
        act(() => result.current.toggle('a'));
        rerender({ order: ['b', 'c', 'd'], key: 'v1' }); // the anchor was deleted
        act(() => result.current.range('d'));
        expect([...result.current.selected]).toEqual(['d']);
    });

    it('a new view starts empty; ids that leave the view drop out', () => {
        const { result, rerender } = renderHook(({ order, key }) => useSelection(order, key), { initialProps: { order: ids, key: 'v1' } });
        act(() => result.current.selectAll());
        expect(result.current.count).toBe(5);
        rerender({ order: ['a', 'b'], key: 'v1' });
        expect(result.current.count).toBe(2);
        rerender({ order: ids, key: 'v2' });
        expect(result.current.count).toBe(0);
        expect(result.current.active).toBe(false);
    });

    it('start enters selection mode empty; clear leaves it; keepOnly narrows', () => {
        const { result } = renderHook(() => useSelection(ids, 'v'));
        act(() => result.current.start());
        expect(result.current.active).toBe(true);
        expect(result.current.count).toBe(0);
        act(() => result.current.selectAll());
        act(() => result.current.keepOnly(['c']));
        expect([...result.current.selected]).toEqual(['c']);
        act(() => result.current.clear());
        expect(result.current.active).toBe(false);
    });
});
