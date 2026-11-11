// SPDX-License-Identifier: AGPL-3.0-only
// Coding-agent bridge, extension side (Stage 2): pairing, scope, reads, proposals.
import { describe, it, expect } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore, EXTENSION_ORIGIN } from './setup';
import { createTrashService } from '../src/sw/trash';
import { createChangeSetsService } from '../src/sw/change_sets';
import { createAgentBridge, handleBridgeMessage, BRIDGE_CLIENTS_KEY, type BridgeClient } from '../src/sw/agent_bridge';
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
    const remote = (type: string, body: Record<string, unknown> = {}, token?: string) =>
        bridge.remoteRequest({ v: 1, id: ++id, type, body, ...(token ? { token } : {}) }) as Promise<{ ok: boolean; body?: Record<string, unknown>; error?: { code: string; message: string } }>;
    return { bridge, req, remote, clock, changeSets };
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
        await s.bridge.updateClient(clientId, { mode: 'read' });
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

    it('D20: apply_changes changes bookmarks at once, undo_changes reverts them, and a retry never applies twice', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const y = fakeBookmarks.seed(f.id, 'Y', 'https://y.example/');
        const { token } = await pairClient(s, 1, [f.id]);
        const changeSet = { title: 'Tidy', ops: [
            { op: 'create_folder', tempId: 'new:1', parentId: f.id, title: 'Sorted' },
            { op: 'move', id: x.id, parentId: 'new:1' },
            { op: 'rename', id: y.id, title: 'Y renamed' },
        ] };
        const r = await s.req(1, 'apply_changes', { changeSet, idempotencyKey: 'a1' }, token);
        expect(r.body).toMatchObject({ accepted: true, applied: true, state: 'applied', changed: 3 });
        expect(fakeBookmarks.titlesIn(f.id).sort()).toEqual(['Sorted', 'Y renamed']);
        const again = await s.req(1, 'apply_changes', { changeSet, idempotencyKey: 'a1' }, token);
        expect(again.body).toMatchObject({ repeated: true, changeSetId: r.body!.changeSetId });
        expect(fakeBookmarks.titlesIn(f.id).sort()).toEqual(['Sorted', 'Y renamed']);
        const u = await s.req(1, 'undo_changes', { id: r.body!.changeSetId }, token);
        expect(u.body).toMatchObject({ undone: true, reverted: 3 });
        expect(fakeBookmarks.titlesIn(f.id).sort()).toEqual(['X', 'Y']);
    });

    it('D20: one bad change refuses the whole call with reasons and changes nothing; review mode only proposes; read mode refuses', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const { token, clientId } = await pairClient(s, 1, [f.id]);
        const bad = await s.req(1, 'apply_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: 'Z' }, { op: 'rename', id: '1', title: 'nope' }] } }, token);
        expect(bad.body).toMatchObject({ accepted: false, applied: false });
        expect((bad.body!.results as Array<{ ok: boolean }>).filter(v => !v.ok)).toHaveLength(1);
        expect(fakeBookmarks.titlesIn(f.id)).toEqual(['X']);
        await s.bridge.updateClient(clientId, { mode: 'propose' });
        const p = await s.req(1, 'apply_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: 'Z' }] } }, token);
        expect(p.body).toMatchObject({ accepted: true, applied: false });
        expect(fakeBookmarks.titlesIn(f.id)).toEqual(['X']);
        await s.bridge.updateClient(clientId, { mode: 'read' });
        expect((await s.req(1, 'apply_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: 'Z' }] } }, token)).error?.code).toBe('READ_ONLY');
        expect((await s.req(1, 'undo_changes', { id: p.body!.changeSetId }, token)).error?.code).toBe('READ_ONLY');
    });

    it('D20: another connection cannot undo a change set it did not make', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const a = await pairClient(s, 1, [f.id]);
        const r = await s.req(1, 'apply_changes', { changeSet: { ops: [{ op: 'rename', id: x.id, title: 'Z' }] } }, a.token);
        const b = await pairClient(s, 2, [f.id]);
        expect((await s.req(2, 'undo_changes', { id: r.body!.changeSetId }, b.token)).error?.code).toBe('INVALID_REQUEST');
        expect(fakeBookmarks.titlesIn(f.id)).toEqual(['Z']);
    });

    it('D20: Ask AI sees every folder except hidden ones, never pairs, and its changes apply with Undo', async () => {
        const s = setup();
        const a = fakeBookmarks.seed('1', 'A');
        fakeBookmarks.seed(a.id, 'Alpha', 'https://alpha.example/');
        const hidden = fakeBookmarks.seed('2', 'Hidden');
        const h = fakeBookmarks.seed(hidden.id, 'Alpha secret', 'https://secret.example/');
        localStore[`fpref_${hidden.id}`] = { hideFromSearch: true };
        const found = await s.bridge.askAI('search', { query: 'alpha' }) as unknown as { body: { items: Array<{ id: string }> } };
        expect(found.body.items.map(i => i.id)).not.toContain(h.id);
        expect(found.body.items).toHaveLength(1);
        const folders = await s.bridge.askAI('list_folders', {}) as unknown as { body: { folders: Array<{ id: string }> } };
        expect(folders.body.folders.map(f => f.id)).toContain(a.id);
        expect(folders.body.folders.map(f => f.id)).not.toContain(hidden.id);
        expect((await s.bridge.askAI('pair', { pairingId: 'x'.repeat(20) }) as unknown as { error: { code: string } }).error.code).toBe('INVALID_REQUEST');
        const r = await s.bridge.askAI('apply_changes', { changeSet: { ops: [{ op: 'rename', id: a.id, title: 'A2' }] } }) as unknown as { body: { applied: boolean; changeSetId: string } };
        expect(r.body.applied).toBe(true);
        expect(fakeBookmarks.titlesIn('1')).toContain('A2');
        const got = await s.changeSets.get(r.body.changeSetId);
        expect(got.ok && got.set.source).toEqual({ kind: 'agent', name: 'Ask AI' });
        expect((await s.bridge.askAI('apply_changes', { changeSet: { ops: [{ op: 'rename', id: h.id, title: 'x' }] } }) as unknown as { body: { accepted: boolean } }).body.accepted).toBe(false);
    });

    it('D24: Ask AI never sends to Trash on its own; the set waits for the user, and Redo replays an undone set', async () => {
        const s = setup();
        const a = fakeBookmarks.seed('1', 'Old', 'https://old.example/');
        const r = await s.bridge.askAI('apply_changes', { changeSet: { title: 'Clean', ops: [{ op: 'trash', id: a.id }] } }) as unknown as { body: { applied: boolean; needsApproval: boolean; changeSetId: string } };
        expect(r.body).toMatchObject({ applied: false, needsApproval: true });
        expect(fakeBookmarks.titlesIn('1')).toContain('Old');
        const got = await s.changeSets.get(r.body.changeSetId);
        expect(got.ok && got.set.state).toBe('pending');
        // A rename alone still applies at once.
        const b = fakeBookmarks.seed('1', 'B', 'https://b.example/');
        const ren = await s.bridge.askAI('apply_changes', { changeSet: { ops: [{ op: 'rename', id: b.id, title: 'B2' }] } }) as unknown as { body: { applied: boolean; changeSetId: string } };
        expect(ren.body.applied).toBe(true);
        expect((await s.changeSets.undo(ren.body.changeSetId)).ok).toBe(true);
        expect(fakeBookmarks.titlesIn('1')).toContain('B');
        const redo = await s.changeSets.redo(ren.body.changeSetId);
        expect(redo.ok).toBe(true);
        expect(fakeBookmarks.titlesIn('1')).toContain('B2');
        expect((await s.changeSets.redo(ren.body.changeSetId)).ok).toBe(false);
    });

    it('security: a token works only on the transport it was issued for, and remote connections strip query strings by default', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        await s.bridge.cancelPrompt(false);
        await s.bridge.openInvite();
        expect((await s.bridge.state()).invite!.stripQuery).toBe(true);
        const code = (await s.bridge.state()).invite!.code;
        const done = await s.remote('pair', { pairingId: 'q'.repeat(20), client: 'Claude', code });
        expect(done.ok).toBe(true);
        const token = done.body!.token as string;
        expect((await s.remote('list_folders', {}, token)).ok).toBe(true);
        expect((await s.req(1, 'list_folders', {}, token)).error?.code).toBe('NOT_PAIRED');
        void f;
    });

    it('F2: a request with an expired token is told why', async () => {
        const s = setup();
        fakeBookmarks.seed('1', 'Work');
        await s.bridge.cancelPrompt(false);
        await s.bridge.openInvite();
        const code = (await s.bridge.state()).invite!.code;
        const token = (await s.remote('pair', { pairingId: 'q'.repeat(20), client: 'Claude', code })).body!.token as string;
        s.clock.t += 91 * 24 * 60 * 60 * 1000;
        expect((await s.remote('list_folders', {}, token)).error?.message).toMatch(/90 days/);
    });

    it('F2: an online connection unused for 90 days is removed and its token stops working', async () => {
        const s = setup();
        fakeBookmarks.seed('1', 'Work');
        await s.bridge.cancelPrompt(false);
        await s.bridge.openInvite();
        const code = (await s.bridge.state()).invite!.code;
        const token = (await s.remote('pair', { pairingId: 'q'.repeat(20), client: 'Claude', code })).body!.token as string;
        s.clock.t += 89 * 24 * 60 * 60 * 1000;
        expect((await s.remote('list_folders', {}, token)).ok).toBe(true);
        s.clock.t += 91 * 24 * 60 * 60 * 1000;
        // The Connect page stops listing it as soon as it has expired, before any request.
        expect((await s.bridge.state()).clients.filter(c => c.name === 'Claude')).toHaveLength(0);
        const late = await s.remote('list_folders', {}, token);
        expect(late.error?.code).toBe('NOT_PAIRED');
    });

    it('D20: the online connector pairs with the standing code on the Connect page, with the folders and mode chosen there', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        // No code showing: the app's sign-in page asks the extension to show one.
        expect((await s.remote('pair', { pairingId: 'p'.repeat(20), client: 'Claude' })).error?.code).toBe('PAIRING_PENDING');
        await s.bridge.cancelPrompt(false);
        await s.bridge.openInvite();
        const st = await s.bridge.state();
        expect(st.invite!.folderIds).toContain('1');
        expect(st.invite!.mode).toBe('change');
        await s.bridge.setInviteGrant([f.id], true, 'change');
        const code = (await s.bridge.state()).invite!.code;
        // The standing code is for the online connector only.
        expect((await s.req(1, 'pair', { pairingId: pid(1), code })).ok).toBe(false);
        const wrong = await s.remote('pair', { pairingId: 'q'.repeat(20), client: 'Claude', code: code === '000000' ? '111111' : '000000' });
        expect(wrong.error?.message).toMatch(/tries left/);
        const done = await s.remote('pair', { pairingId: 'q'.repeat(20), client: 'Claude', code });
        expect(done.ok).toBe(true);
        expect((await s.bridge.state()).invite).toBeUndefined();
        const stored = Object.values(localStore[BRIDGE_CLIENTS_KEY] as Record<string, BridgeClient>);
        expect(stored[0]).toMatchObject({ name: 'Claude', transport: 'remote', folderIds: [f.id], stripQuery: true, mode: 'change' });
        const list = await s.remote('list_folders', {}, done.body!.token as string);
        expect((list.body!.folders as Array<{ id: string }>).map(x => x.id)).toEqual([f.id]);
        await s.bridge.removeTransport('remote');
        expect((await s.remote('list_folders', {}, done.body!.token as string)).error?.code).toBe('NOT_PAIRED');
    });

    it('D20: five wrong standing codes end it', async () => {
        const s = setup();
        await s.bridge.openInvite();
        const code = (await s.bridge.state()).invite!.code;
        const other = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 4; i++) expect((await s.remote('pair', { pairingId: 'q'.repeat(20), code: other })).error?.code).toBe('PAIRING_PENDING');
        expect((await s.remote('pair', { pairingId: 'q'.repeat(20), code: other })).error?.code).toBe('NOT_PAIRED');
        expect((await s.bridge.state()).invite).toBeUndefined();
    });

    it('review D20-3: at most 10 new sign-in codes an hour, and a new code keeps the folders the user chose', async () => {
        const s = setup();
        const f = fakeBookmarks.seed('1', 'Work');
        await s.bridge.openInvite();
        await s.bridge.setInviteGrant([f.id], true, 'read');
        for (let i = 0; i < 9; i++) { await s.bridge.closeInvite(); expect(await s.bridge.openInvite()).toBe(true); }
        const kept = (await s.bridge.state()).invite!;
        expect(kept).toMatchObject({ folderIds: [f.id], stripQuery: true, mode: 'read' });
        await s.bridge.closeInvite();
        expect(await s.bridge.openInvite()).toBe(false);
        const st = await s.bridge.state();
        expect(st.invite).toBeUndefined();
        expect(st.inviteRetryAt).toBeGreaterThan(s.clock.t);
        s.clock.t += 3600_001;
        expect(await s.bridge.openInvite()).toBe(true);
    });
});
