// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';

/**
 * Multi-select for the items on screen. Holds ids only; ranges use the display
 * order at the moment of the click. The selection belongs to one view: a new
 * `viewKey` (folder, search, filter or sort) starts empty.
 */
export function useSelection(orderedIds: string[], viewKey: string) {
    const [state, setState] = useState<{ viewKey: string; active: boolean; ids: Set<string>; anchor: string | null }>(
        { viewKey, active: false, ids: new Set(), anchor: null },
    );

    // A different view: forget the old selection (computed during render, no effect).
    const current = state.viewKey === viewKey ? state : { viewKey, active: false, ids: new Set<string>(), anchor: null };
    if (current !== state) setState(current);

    // Ids that left the view (deleted or moved elsewhere) drop out for good, so an
    // item that comes back later is not silently selected again.
    const visible = new Set(orderedIds);
    const selected = new Set([...current.ids].filter(id => visible.has(id)));
    if (current === state && (selected.size !== state.ids.size || (state.anchor !== null && !visible.has(state.anchor)))) {
        setState({ ...state, ids: selected, anchor: state.anchor !== null && visible.has(state.anchor) ? state.anchor : null });
    }

    const toggle = useCallback((id: string) => {
        setState(s => {
            const ids = new Set(s.ids);
            if (ids.has(id)) ids.delete(id); else ids.add(id);
            return { ...s, active: true, ids, anchor: id };
        });
    }, []);

    /** Shift+click: select from the anchor to `id`. Without a usable anchor, a plain toggle. */
    const range = useCallback((id: string) => {
        setState(s => {
            const from = s.anchor ? orderedIds.indexOf(s.anchor) : -1;
            const to = orderedIds.indexOf(id);
            if (from < 0 || to < 0) {
                const ids = new Set(s.ids);
                if (ids.has(id)) ids.delete(id); else ids.add(id);
                return { ...s, active: true, ids, anchor: id };
            }
            const [a, b] = from < to ? [from, to] : [to, from];
            const ids = new Set(s.ids);
            for (const x of orderedIds.slice(a, b + 1)) ids.add(x);
            return { ...s, active: true, ids, anchor: s.anchor };
        });
    }, [orderedIds]);

    const selectAll = useCallback(() => {
        setState(s => ({ ...s, active: true, ids: new Set(orderedIds), anchor: s.anchor ?? orderedIds[0] ?? null }));
    }, [orderedIds]);

    /** Enter selection mode with nothing selected (the Select button). */
    const start = useCallback(() => setState(s => ({ ...s, active: true })), []);
    /** Leave selection mode. */
    const clear = useCallback(() => setState(s => ({ ...s, active: false, ids: new Set(), anchor: null })), []);
    /** Keep only these ids selected (for example the ones a bulk action could not handle). */
    const keepOnly = useCallback((ids: string[]) => setState(s => ({ ...s, active: true, ids: new Set(ids) })), []);

    return {
        active: current.active || selected.size > 0,
        selected,
        count: selected.size,
        isSelected: (id: string) => selected.has(id),
        toggle, range, selectAll, start, clear, keepOnly,
    };
}
