// SPDX-License-Identifier: AGPL-3.0-only
// Online connector, browser side (D20): the link socket, hello, relaying, keepalive, new address.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localStore } from './setup';
import { createRemoteLink, allowedOrigin, CONNECTOR_KEY } from '../src/sw/remote_link';
import { CONNECTOR_ORIGIN } from '../src/lib/bridge/connector';

class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) { }
    send(s: string) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    deliver(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

describe('remote link', () => {
    let sockets: FakeSocket[];
    beforeEach(() => {
        sockets = [];
        vi.stubGlobal('WebSocket', FakeSocket);
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    const make = (handle = vi.fn(async (req: unknown) => ({ v: 1, id: (req as { id: number }).id, ok: true as const, body: { got: (req as { type: string }).type } }))) => ({
        handle,
        link: createRemoteLink({
            handle, broadcast: () => undefined, extVersion: '1.7.0',
            makeSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s as unknown as WebSocket; },
        }),
    });

    it('stays off until switched on; then says hello with its id and secret, and shows the address', async () => {
        const { link } = make();
        await link.start();
        expect(sockets).toHaveLength(0);
        const st = await link.setEnabled(true);
        expect(sockets).toHaveLength(1);
        const rec = localStore[CONNECTOR_KEY] as { linkId: string; secret: string };
        expect(rec.linkId).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(rec.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(sockets[0].url).toBe(`${CONNECTOR_ORIGIN.replace('https', 'wss')}/link?id=${rec.linkId}`);
        expect(st.address).toBe(`${CONNECTOR_ORIGIN}/mcp/${rec.linkId}`);
        expect(st.address).not.toContain(rec.secret);
        sockets[0].open();
        expect(sockets[0].sent[0]).toMatchObject({ type: 'hello', linkId: rec.linkId, secret: rec.secret });
        sockets[0].deliver({ type: 'ready' });
        expect((await link.state()).status).toBe('connected');
    });

    it('relays each request to the bridge and sends the answer back with the same rid; answers pings', async () => {
        const { link, handle } = make();
        await link.setEnabled(true);
        sockets[0].open();
        sockets[0].deliver({ type: 'request', rid: 'r1', via: 'Claude', req: { v: 1, id: 9, type: 'search', body: {} } });
        await vi.waitFor(() => expect(sockets[0].sent.find(m => m.type === 'response')).toBeTruthy());
        expect(handle).toHaveBeenCalledWith({ v: 1, id: 9, type: 'search', body: {} });
        expect(sockets[0].sent.find(m => m.type === 'response')).toMatchObject({ rid: 'r1', res: { ok: true, body: { got: 'search' } } });
        sockets[0].deliver({ type: 'ping' });
        expect(sockets[0].sent.at(-1)).toEqual({ type: 'pong' });
        vi.advanceTimersByTime(20_000);
        expect(sockets[0].sent.at(-1)).toEqual({ type: 'ping' });
    });

    it('reconnects after a drop, closes when switched off, and a new address changes id and secret', async () => {
        const { link } = make();
        await link.setEnabled(true);
        sockets[0].open();
        const first = { ...(localStore[CONNECTOR_KEY] as { linkId: string; secret: string }) };
        sockets[0].close();
        await vi.advanceTimersByTimeAsync(2_500);
        expect(sockets).toHaveLength(2);
        await link.newAddress();
        const second = localStore[CONNECTOR_KEY] as { linkId: string; secret: string };
        expect(second.linkId).not.toBe(first.linkId);
        expect(second.secret).not.toBe(first.secret);
        await link.setEnabled(false);
        expect(sockets.at(-1)!.readyState).toBe(3);
        const count = sockets.length;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(sockets.length).toBe(count);
        expect((await link.state()).status).toBe('off');
    });

    it('only a local development server may replace the production address', () => {
        expect(allowedOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
        expect(allowedOrigin('http://localhost:8787')).toBe('http://localhost:8787');
        expect(allowedOrigin('https://evil.example')).toBeUndefined();
        expect(allowedOrigin('http://127.0.0.1.evil.example')).toBeUndefined();
    });
});
