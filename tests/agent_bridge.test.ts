// SPDX-License-Identifier: AGPL-3.0-only
// Coding-agent bridge, extension side (Stage 2): pairing, scope, reads, proposals.
import { describe, it, expect } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore, EXTENSION_ORIGIN } from './setup';
import { createTrashService } from '../src/sw/trash';
import { createChangeSetsService } from '../src/sw/change_sets';
import { createAgentBridge, handleBridgeMessage, BRIDGE_CLIENTS_KEY } from '../src/sw/agent_bridge';
import { ERROR_CODES, EXIT_CODES, bridgeError } from '../src/lib/bridge/protocol';

function setup() {
    const clock = { t: 5_000_000 };
    const trash = createTrashService({ broadcast: () => undefined, now: () => clock.t });
    const changeSets = createChangeSetsService({ trash, broadcast: () => undefined, now: () => clock.t });
    let seq = 1;
    const bridge = createAgentBridge({
        changeSets, now: () => clock.t, broadcast: () => undefined, extVersion: '1.7.0',
        // Deterministic bytes: pairing code from the first 4 bytes.
        randomBytes: (n) => Uint8Array.from({ length: n }, () => (seq++ * 37) % 256),
    });
    let id = 0;
    const req = (conn: number, type: string, body: Record<string, unknown> = {}, token?: string) =>
        bridge._request(conn, { v: 1, id: ++id, type, body, ...(token ? { token } : {}) }) as Promise<{ ok: boolean; body?: Record<string, unknown>; error?: { code: string; message: string; fix: string; retry: string; docUrl: string } }>;
    return { bridge, req, clock, changeSets };
}

const pid = (conn: number) => `pairing-id-for-conn-${conn}`;

async function pairClient(s: ReturnType<typeof setup>, conn = 1, grant: string[] = []) {
    await s.req(conn, 'hello', { protocolVersion: 1, client: 'Claude Code' });
    const start = await s.req(conn, 'pair', { pairingId: pid(conn) });
    expect(start.error?.code).toBe('PAIRING_PENDING');
    const state = await s.bridge.state();
    await s.bridge.setPromptGrant(grant, false);
    const done = await s.req(conn, 'pair', { pairingId: pid(conn), code: state.prompt!.code });
    expect(done.ok).toBe(true);
    return { token: done.body!.token as string, clientId: done.body!.clientId as string };
}

describe('agent bridge', () => {
    it('every error carries code, message, fix, retry and a docs link; codes have fixed exit statuses', () => {
        for (const code of ERROR_CODES) {
            const e = bridgeError(code, 'x');
            expect(e.fix.length).toBeGreaterThan(5);
            expect(['after_user_action', 'after_seconds', 'never']).toContain(e.retry);
            expect(e.docUrl).toMatch(/#[a-z_]+$/);
            expect(EXIT_CODES[code]).toBeGreaterThan(1);
        }
    });

    it('refuses every read before pairing, with the next step', async () => {
        const s = setup();
        expect((await s.req(1, 'pair', {})).error?.code).toBe('INVALID_REQUEST');
        for (const type of ['list_folders', 'list_folder', 'search', 'get_bookmark', 'propose_changes', 'get_change_set']) {
            const r = await s.req(1, type, {});
            expect(r.error?.code).toBe('NOT_PAIRED');
            expect(r.error?.fix).toMatch(/pair/);
        }
    });

    it('pairs with the code shown only in the extension; the code never goes to the client', async () => {
        const s = setup();
        await s.req(1, 'hello', { protocolVersion: 1, client: 'Claude‮ Code' });
        const start = await s.req(1, 'pair', { pairingId: pid(1) });
        const state = await s.bridge.state();
        expect(JSON.stringify(start)).not.toContain(state.prompt!.code);
        expect(state.prompt!.name).toBe('Claude Code');
        const done = await s.req(1, 'pair', { pairingId: pid(1), code: state.prompt!.code });
        expect(done.ok).toBe(true);
        const stored = localStore[BRIDGE_CLIENTS_KEY] as Record<string, { tokenHash: string }>;
        expect(JSON.stringify(stored)).not.toContain(done.body!.token as string);
    });

    it('binds the prompt to the agent that started it, ends it after three wrong codes, and rate limits prompts', async () => {
        const s = setup();
        await s.req(1, 'pair', { pairingId: pid(1) });
        const code = (await s.bridge.state()).prompt!.code;
        expect((await s.req(2, 'pair', { pairingId: pid(2), code })).error?.code).toBe('NOT_PAIRED');
        expect((await s.req(2, 'pair', { pairingId: pid(2) })).error?.code).toBe('RATE_LIMITED');
        await s.req(1, 'pair', { pairingId: pid(1), code: '000000' === code ? '111111' : '000000' });
        await s.req(1, 'pair', { pairingId: pid(1), code: 'abc' });
        const third = await s.req(1, 'pair', { pairingId: pid(1), code: 'xyz' });
        expect(third.error?.message).toMatch(/three times/);
        expect((await s.bridge.state()).prompt).toBeUndefined();
        for (let i = 0; i < 4; i++) { await s.req(1, 'pair', { pairingId: pid(1) }); await s.bridge.cancelPrompt(false); }
        expect((await s.req(1, 'pair', { pairingId: pid(1) })).error?.code).toBe('RATE_LIMITED');
    });

    it('expires a prompt after 2 minutes', async () => {
        const s = setup();
        await s.req(1, 'pair', { pairingId: pid(1) });
        const code = (await s.bridge.state()).prompt!.code;
        s.clock.t += 121_000;
        expect((await s.req(1, 'pair', { pairingId: pid(1), code })).error?.code).toBe('NOT_PAIRED');
    });

    it('reads only granted folders, never hidden ones, for every tool and id', async () => {
        const s = setup();
        const shared = fakeBookmarks.seed('1', 'Shared');
        const a = fakeBookmarks.seed(shared.id, 'Alpha docs', 'https://alpha.example/?t=1');
        const hidden = fakeBookmarks.seed(shared.id, 'Secret');
        const h = fakeBookmarks.seed(hidden.id, 'Alpha secret', 'https://secret.example/');
        const other = fakeBookmarks.seed('1', 'Other');
        const o = fakeBookmarks.seed(other.id, 'Alpha other', 'https://other.example/');
        localStore[`fpref_${hidden.id}`] = { hideFromSearch: true };
        const { token, clientId } = await pairClient(s, 1, [shared.id]);

        const folders = await s.req(1, 'list_folders', {}, token);
        expect((folders.body!.folders as Array<{ id: string }>).map(f => f.id)).toEqual([shared.id]);
        const found = await s.req(1, 'search', { query: 'alpha' }, token);
        expect((found.body!.items as Array<{ id: string }>).map(i => i.id)).toEqual([a.id]);
        for (const id of [h.id, hidden.id, o.id, other.id, '0', '1']) {
            expect((await s.req(1, 'get_bookmark', { id }, token)).ok).toBe(false);
            expect((await s.req(1, 'list_folder', { id }, token)).ok).toBe(false);
        }
        // Query stripping per client.
        await s.bridge.updateClient(clientId, { stripQuery: true });
        const one = await s.req(1, 'get_bookmark', { id: a.id }, token);
        expect(one.body!.url).toBe('https://alpha.example/');
    });

    it('review F5/F6: search never matches a stripped query; paths start at the granted folder; counts show only shared items', async () => {
        const s = setup();
        const secret = fakeBookmarks.seed('1', 'Secret Project Falcon');
        const shared = fakeBookmarks.seed(secret.id, 'Shared');
        fakeBookmarks.seed(shared.id, 'Reset', 'https://x.example/reset?token=s3cretvalue');
        const hidden = fakeBookmarks.seed(shared.id, 'Hidden');
        localStore[`fpref_${hidden.id}`] = { hideFromSearch: true };
        const { token, clientId } = await pairClient(s, 1, [shared.id]);
        await s.bridge.updateClient(clientId, { stripQuery: true });
        expect((await s.req(1, 'search', { query: 's3cret' }, token)).body!.total).toBe(0);
        expect((await s.req(1, 'search', { query: 'reset' }, token)).body!.total).toBe(1);
        const f = await s.req(1, 'list_folders', {}, token);
        const folder = (f.body!.folders as Array<{ path: string; count: number }>)[0];
        expect(folder.path).toBe('Shared');
        expect(folder.count).toBe(1);
        expect(JSON.stringify(f)).not.toContain('Falcon');
    });

    it('pages with opaque cursors that go stale after a change', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Many');
        for (let i = 0; i < 7; i++) fakeBookmarks.seed(f.id, `B${i}`, `https://b${i}.example/`);
        const { token } = await pairClient(s, 1, [f.id]);
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
            const r = await s.req(1, 'list_folder', { id: f.id, limit: 3, cursor }, token);
            seen.push(...(r.body!.items as Array<{ id: string }>).map(i => i.id));
            cursor = r.body!.cursor as string | undefined;
        } while (cursor);
        expect(new Set(seen).size).toBe(7);
        const first = await s.req(1, 'list_folder', { id: f.id, limit: 3 }, token);
        s.bridge.invalidate();
        const stale = await s.req(1, 'list_folder', { id: f.id, limit: 3, cursor: first.body!.cursor }, token);
        expect(stale.error?.code).toBe('CURSOR_EXPIRED');
    });

    it('proposals need Read and propose, go to the review panel, and repeat safely with an idempotency key', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const { token, clientId } = await pairClient(s, 1, [f.id]);
        const changeSet = { ops: [{ op: 'rename', id: x.id, title: 'X renamed' }] };
        expect((await s.req(1, 'propose_changes', { changeSet }, token)).error?.code).toBe('READ_ONLY');
        await s.bridge.updateClient(clientId, { mode: 'propose' });
        const r1 = await s.req(1, 'propose_changes', { changeSet, idempotencyKey: 'k1' }, token);
        expect(r1.body).toMatchObject({ accepted: true });
        const r2 = await s.req(1, 'propose_changes', { changeSet, idempotencyKey: 'k1' }, token);
        expect(r2.body!.changeSetId).toBe(r1.body!.changeSetId);
        const r3 = await s.req(1, 'propose_changes', { changeSet: { ops: [] }, idempotencyKey: 'k1' }, token);
        expect(r3.error?.code).toBe('INVALID_REQUEST');
        // Nothing changed: it waits for the user.
        expect(fakeBookmarks.titlesIn(f.id)).toEqual(['X']);
        const st = await s.req(1, 'get_change_set', { id: r1.body!.changeSetId }, token);
        expect(st.body!.state).toBe('pending');
        // Outside the grant: refused with reasons, still nothing changed.
        const out = await s.req(1, 'propose_changes', { changeSet: { ops: [{ op: 'rename', id: '1', title: 'nope' }] } }, token);
        expect(out.body).toMatchObject({ accepted: false });
    });

    it('caps pending sets per agent at 5', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const { token, clientId } = await pairClient(s, 1, [f.id]);
        await s.bridge.updateClient(clientId, { mode: 'propose' });
        for (let i = 0; i < 5; i++) expect((await s.req(1, 'propose_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: `t${i}` }] } }, token)).body!.accepted).toBe(true);
        expect((await s.req(1, 'propose_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: 'z' }] } }, token)).error?.code).toBe('RATE_LIMITED');
    });

    it('another agent cannot read a change set it did not send; removing a client refuses its token', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const a = await pairClient(s, 1, [f.id]);
        await s.bridge.updateClient(a.clientId, { mode: 'propose' });
        const p = await s.req(1, 'propose_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: 'Y' }] } }, a.token);
        const b = await pairClient(s, 2, [f.id]);
        expect((await s.req(2, 'get_change_set', { id: p.body!.changeSetId }, b.token)).ok).toBe(false);
        await s.bridge.removeClient(a.clientId);
        expect((await s.req(1, 'list_folders', {}, a.token)).error?.code).toBe('NOT_PAIRED');
    });

    it('rejects old packages and newer protocols with the update to run', async () => {
        const s = setup();
        expect((await s.req(1, 'hello', { protocolVersion: 0 })).error?.code).toBe('UPDATE_PACKAGE');
        expect((await s.req(1, 'hello', { protocolVersion: 9 })).error?.code).toBe('UPDATE_EXTENSION');
    });

    it('page messages only from extension pages, never in incognito; state never exposes token hashes', async () => {
        const s = setup();
        await pairClient(s, 1, []);
        expect(await handleBridgeMessage(s.bridge, { type: 'BRIDGE_STATE' }, { url: 'https://evil.example/' }, false)).toMatchObject({ ok: false });
        expect(await handleBridgeMessage(s.bridge, { type: 'BRIDGE_STATE' }, { url: `${EXTENSION_ORIGIN}index.html` }, true)).toMatchObject({ ok: false });
        const st = await handleBridgeMessage(s.bridge, { type: 'BRIDGE_STATE' }, { url: `${EXTENSION_ORIGIN}index.html` }, false);
        expect(JSON.stringify(st)).not.toContain('tokenHash');
    });
});
