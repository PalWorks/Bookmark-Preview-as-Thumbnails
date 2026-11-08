// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLinkMeta } from '../../src/popup/hooks/useLinkMeta';
import { localStore } from '../setup';

type Listener = (m: unknown) => void;

describe('useLinkMeta', () => {
    it('reads the links on screen and refreshes every link named by back-to-back broadcasts', async () => {
        const listeners: Listener[] = [];
        (chrome.runtime.onMessage.addListener as unknown as { mockImplementation: (f: (l: Listener) => void) => void })
            .mockImplementation((l: Listener) => { listeners.push(l); });
        localStore['meta_https://a.example/'] = { id: 'https://a.example/', url: 'https://a.example/', title: '', status: 'none', rating: 1 };
        const urls = ['https://a.example/', 'https://b.example/'];
        const { result } = renderHook(() => useLinkMeta(urls));
        await waitFor(() => expect(result.current.meta['https://a.example/']?.rating).toBe(1));
        localStore['meta_https://a.example/'] = { ...(localStore['meta_https://a.example/'] as object), rating: 5 };
        localStore['meta_https://b.example/'] = { id: 'https://b.example/', url: 'https://b.example/', title: '', status: 'none', rating: 3 };
        act(() => {
            listeners.forEach(l => l({ type: 'META_UPDATED', urls: ['https://a.example/'] }));
            listeners.forEach(l => l({ type: 'META_UPDATED', urls: ['https://b.example/'] }));
        });
        await waitFor(() => expect(result.current.meta['https://a.example/']?.rating).toBe(5));
        expect(result.current.meta['https://b.example/']?.rating).toBe(3);
    });
});
