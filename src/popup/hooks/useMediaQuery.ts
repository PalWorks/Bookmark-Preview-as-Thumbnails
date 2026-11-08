// SPDX-License-Identifier: AGPL-3.0-only
import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (false where matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            if (typeof window === 'undefined' || !window.matchMedia) return () => { };
            const mq = window.matchMedia(query);
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        },
        () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
        () => false,
    );
}

/** Phones and narrow windows: the folder panel becomes a drawer. */
export const NARROW_QUERY = '(max-width: 719px)';
