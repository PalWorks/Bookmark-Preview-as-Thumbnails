// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any */
// LinkObject: hello and secret rules, one live socket, relaying, codes, limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkObject, MCP_PER_MINUTE, NEW_TOKEN_PER_MINUTE } from '../src/link.ts';
import { FakeSocket, LINK_ID, LINK_SECRET, linkState } from './fakes.ts';

const hello = (over: Record<string, unknown> = {}) => JSON.stringify({ type: 'hello', linkId: LINK_ID, secret: LINK_SECRET, extVersion: '1.7.0', protocolVersion: 1, ...over });

function setup() {
    const st = linkState();
    const obj = new LinkObject(st as any);
    const connect = async (frame = hello()) => {
        const ws = new FakeSocket();
        obj.accept(ws as any, LINK_ID);
        await obj.webSocketMessage(ws as any, frame);
        return ws;
    };
    return { st, obj, connect };
}

test('first hello stores sha256 of the secret and answers ready', async () => {
    const { st, connect } = setup();
    const ws = await connect();
    assert.deepEqual(ws.sent, [{ type: 'ready' }]);
    const stored = await st.storage.get<string>('secretHash');
    assert.ok(stored && stored !== LINK_SECRET && stored.length === 43);
});

test('a later hello with another secret is refused and closed', async () => {
    const { connect } = setup();
    await connect();
    const bad = await connect(hello({ secret: 'T'.repeat(43) }));
    assert.equal(bad.sent[0].type, 'refused');
    assert.ok(bad.closed);
});

test('hello must name the routed link and well-formed ids', async () => {
    const { connect, st } = setup();
    for (const frame of [hello({ linkId: 'BBBBBBBBBBBBBBBBBBBBBB' }), hello({ linkId: 'short' }), hello({ secret: 'short' }), JSON.stringify({ type: 'ping' }), 'not json']) {
        const ws = await connect(frame);
        assert.equal(ws.sent[0]?.type, 'refused', frame);
        assert.ok(ws.closed);
    }
    assert.equal(await st.storage.get('secretHash'), undefined);
});

test('a new authenticated socket replaces the old one', async () => {
    const { connect } = setup();
    const a = await connect();
    const b = await connect();
    assert.equal(a.closed?.code, 4000);
    assert.equal(b.closed, null);
});

test('pings get pongs once authenticated', async () => {
    const { obj, connect } = setup();
    const ws = await connect();
    await obj.webSocketMessage(ws as any, JSON.stringify({ type: 'ping' }));
    assert.deepEqual(ws.sent.at(-1), { type: 'pong' });
});

test('relay sends a request frame and resolves with the matching response', async () => {
    const { obj, connect } = setup();
    const ws = await connect();
    const p = obj.relay({ v: 1, id: 'r1', type: 'list_folders', token: 't', body: {} }, 'AI app');
    const frame = ws.sent.at(-1);
    assert.equal(frame.type, 'request');
    assert.equal(frame.via, 'AI app');
    assert.deepEqual(frame.req, { v: 1, id: 'r1', type: 'list_folders', token: 't', body: {} });
    await obj.webSocketMessage(ws as any, JSON.stringify({ type: 'response', rid: 'other', res: { ok: true } }));
    await obj.webSocketMessage(ws as any, JSON.stringify({ type: 'response', rid: frame.rid, res: { v: 1, id: 'r1', ok: true, body: { n: 1 } } }));
    assert.deepEqual(await p, { v: 1, id: 'r1', ok: true, body: { n: 1 } });
});

test('without a socket, and when the socket drops, relay answers NOT_CONNECTED', async () => {
    const { obj, connect } = setup();
    const none = await obj.relay({ v: 1, id: 1, type: 'search', body: {} }, 'AI app');
    assert.equal(none.ok, false);
    assert.equal((none as any).error.code, 'NOT_CONNECTED');
    assert.match((none as any).error.message, /Open Chrome on your computer/);
    obj.reconnectGraceMs = 10;
    const ws = await connect();
    const p = obj.relay({ v: 1, id: 2, type: 'search', body: {} }, 'AI app');
    ws.closed = { code: 1006 };
    await obj.webSocketClose(ws as any, 1006);
    assert.equal(((await p) as any).error.code, 'NOT_CONNECTED');
});

test('a request in flight when the socket drops is answered on the new socket', async () => {
    const { obj, connect } = setup();
    obj.reconnectGraceMs = 1_000;
    const a = await connect();
    const p = obj.relay({ v: 1, id: 3, type: 'apply_changes', body: {} }, 'AI app');
    const rid = a.sent.at(-1).rid;
    a.closed = { code: 1006 };
    await obj.webSocketClose(a as any, 1006);
    const b = await connect();
    await obj.webSocketMessage(b as any, JSON.stringify({ type: 'response', rid, res: { v: 1, id: 3, ok: true, body: { applied: true } } }));
    assert.deepEqual(await p, { v: 1, id: 3, ok: true, body: { applied: true } });
});

test('authorization codes work once, and not after 2 minutes', async () => {
    const { obj } = setup();
    let t = 1_000_000;
    obj.now = () => t;
    const rec = { token: 'tok_abcdefghijklmnopqrstuvwxyz', clientId: 'c', redirectUri: 'https://a.example/cb', codeChallenge: 'x' };
    const code = await obj.putCode(LINK_ID, rec);
    assert.ok(code.startsWith(`${LINK_ID}.`));
    assert.equal((await obj.takeCode(code))?.token, rec.token);
    assert.equal(await obj.takeCode(code), null);
    const late = await obj.putCode(LINK_ID, rec);
    t += 2 * 60_000 + 1;
    assert.equal(await obj.takeCode(late), null);
});

test('stored codes are keyed by hash and swept by the alarm', async () => {
    const { obj, st } = setup();
    let t = 0;
    obj.now = () => t;
    const code = await obj.putCode(LINK_ID, { token: 'tok_abcdefghijklmnopqrstuvwxyz', clientId: 'c', redirectUri: 'r', codeChallenge: 'x' });
    assert.ok(![...st.storage.store.keys()].some((k) => k.includes(code)));
    assert.ok(st.storage.alarmAt !== null);
    t = 3 * 60_000;
    await obj.alarm();
    assert.equal([...st.storage.store.keys()].filter((k) => k.startsWith('code:')).length, 0);
});

test('60 MCP requests a minute per link', async () => {
    const { obj } = setup();
    let t = 0;
    obj.now = () => t;
    for (let i = 0; i < MCP_PER_MINUTE; i++) assert.equal(await obj.takeMcpSlot(), true);
    assert.equal(await obj.takeMcpSlot(), false);
    t = 60_000;
    assert.equal(await obj.takeMcpSlot(), true);
});

test('networkOf: IPv4 as itself, IPv4-mapped IPv6 as the IPv4, IPv6 as its /64', async () => {
    const { networkOf } = await import('../src/limiter.ts');
    assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
    assert.equal(networkOf('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(networkOf('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
});

test('F6: guessed tokens use their own budget and a refused token stops reaching the browser', async () => {
    const { obj, connect } = setup();
    const ws = await connect();
    const mcp = (token: string, method = 'tools/call') => obj.fetch(new Request('https://link/mcp', {
        method: 'POST', headers: { 'X-Link-Id': LINK_ID },
        body: JSON.stringify({ token, text: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { name: 'list_folders', arguments: {} } }) }),
    }));
    // The browser answers: the real token works, anything else is not paired.
    const answer = async () => {
        for (let i = 0; i < 50; i++) {
            const f = ws.sent.at(-1);
            if (f?.type === 'request' && !f.answered) {
                f.answered = true;
                const ok = f.req.token === 'real-token-real-token-1';
                await obj.webSocketMessage(ws as any, JSON.stringify({ type: 'response', rid: f.rid, res: ok ? { v: 1, id: f.req.id, ok: true, body: {} } : { v: 1, id: f.req.id, ok: false, error: { code: 'NOT_PAIRED', message: 'no' } } }));
                return;
            }
            await new Promise((r) => setTimeout(r, 1));
        }
    };
    const run = async (token: string) => { const p = mcp(token); await answer(); return (await p).json() as Promise<any>; };

    assert.equal((await run('real-token-real-token-1')).status, 200);
    // A refused guess is answered 401, then answered 401 again without asking the browser.
    assert.equal((await run('guess-token-guess-tok-0')).status, 401);
    const before = ws.sent.length;
    assert.equal(((await (await mcp('guess-token-guess-tok-0')).json()) as any).status, 401);
    assert.equal(ws.sent.length, before);
    // New guesses use up only their own budget; the real connection keeps working.
    for (let i = 1; i < NEW_TOKEN_PER_MINUTE; i++) await run(`guess-token-guess-tok-${i}`);
    assert.equal((await mcp('guess-token-guess-tok-99')).status, 429);
    assert.equal((await run('real-token-real-token-1')).status, 200);
});
