// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBookmarks } from './fakes/chrome_bookmarks';
import { localStore, EXTENSION_ORIGIN } from './setup';
import { parseChangeSet, type ChangeOp, type ChangeSetInput } from '../src/lib/change_set/format';
import { validateChangeSet } from '../src/lib/change_set/validate';
import { createTrashService } from '../src/sw/trash';
import {
    createChangeSetsService, handleChangeSetMessage, csKey, csjItemKey,
    type ChangeSetRecord, type JournalItem,
} from '../src/sw/change_sets';
import { isLegacyMetaRecord, migrateStorageSchema } from '../src/lib/storage_migration';
import { storageIndex } from '../src/lib/storage_index';

const set = (ops: ChangeOp[], extra: Partial<ChangeSetInput> = {}): ChangeSetInput => ({ format: 'bookmarks-thumbnails.changes', v: 1, ops, ...extra });
const text = (ops: ChangeOp[], extra: Partial<ChangeSetInput> = {}) => JSON.stringify(set(ops, extra));

async function tree() {
    return chrome.bookmarks.getTree();
}

function svc(nowRef = { t: 1_000_000 }) {
    const trash = createTrashService({ broadcast: () => undefined, now: () => nowRef.t });
    let n = 0;
    const cs = createChangeSetsService({ trash, broadcast: () => undefined, now: () => nowRef.t, uuid: () => `id-${++n}` });
    return { cs, trash, nowRef };
}

/** Titles of the tree under a folder, nested, for before/after comparisons. */
async function shape(id: string): Promise<unknown> {
    const [n] = await chrome.bookmarks.getSubTree(id);
    const walk = (x: chrome.bookmarks.BookmarkTreeNode): unknown => (x.url ? x.title : { [x.title]: (x.children ?? []).map(walk) });
    return walk(n);
}

describe('change-set format', () => {
    it('reads JSON from a code fence with text around it', () => {
        const r = parseChangeSet('Here you go:\n```json\n' + text([{ op: 'rename', id: '5', title: 'X' }]) + '\n```\nDone.');
        expect(r.ok).toBe(true);
    });

    it('refuses non-JSON, an empty list, unknown changes and too many changes', () => {
        expect(parseChangeSet('no json here').ok).toBe(false);
        expect(parseChangeSet('{"ops":[]}').ok).toBe(false);
        const unknown = parseChangeSet('{"ops":[{"op":"delete_everything","id":"1"}]}');
        expect(unknown.ok === false && unknown.error).toMatch(/Unknown change/);
        const many = parseChangeSet(JSON.stringify({ ops: Array.from({ length: 201 }, () => ({ op: 'trash', id: '9' })) }));
        expect(many.ok === false && many.error).toMatch(/limit is 200/);
    });

    it('strips control and bidi characters from titles', () => {
        const r = parseChangeSet(text([{ op: 'rename', id: '5', title: 'a‮b\u0007c' }]));
        expect(r.ok && r.set.ops[0]).toEqual({ op: 'rename', id: '5', title: 'abc' });
    });
});

describe('change-set validation', () => {
    it('refuses unknown, hidden and out-of-scope ids with the same reason', async () => {
        const shared = fakeBookmarks.seed('1', 'Shared');
        const other = fakeBookmarks.seed('1', 'Other');
        const inOther = fakeBookmarks.seed(other.id, 'B', 'https://b.example/');
        const hiddenF = fakeBookmarks.seed(shared.id, 'Hidden');
        const inHidden = fakeBookmarks.seed(hiddenF.id, 'H', 'https://h.example/');
        const v = validateChangeSet(set([
            { op: 'rename', id: '999', title: 'x' },
            { op: 'rename', id: inOther.id, title: 'x' },
            { op: 'rename', id: inHidden.id, title: 'x' },
        ]), { roots: await tree(), hiddenFolderIds: new Set([hiddenF.id]), scopeFolderIds: new Set([shared.id]) });
        expect(v.ok).toBe(false);
        const reasons = v.verdicts.map(x => x.reason);
        expect(new Set(reasons).size).toBe(1);
    });

    it('applies every rule of Stage 1.3', async () => {
        const a = fakeBookmarks.seed('1', 'A');
        const b = fakeBookmarks.seed(a.id, 'B');
        const x = fakeBookmarks.seed('1', 'X', 'https://same.example/');
        const y = fakeBookmarks.seed('2', 'Y', 'https://same.example/');
        const m = fakeBookmarks.seed('1', 'M', 'https://m.example/', { unmodifiable: 'managed' } as never);
        const ctx = async () => ({ roots: await tree(), hiddenFolderIds: new Set<string>() });
        const one = async (ops: ChangeOp[]) => validateChangeSet(set(ops), await ctx());

        expect((await one([{ op: 'move', id: a.id, parentId: b.id }])).verdicts[0].reason).toMatch(/inside itself/);
        expect((await one([{ op: 'rename', id: '1', title: 'Bar' }])).verdicts[0].reason).toMatch(/Chrome's own/);
        expect((await one([{ op: 'rename', id: m.id, title: 'x' }])).verdicts[0].reason).toMatch(/Managed/);
        expect((await one([{ op: 'move', id: x.id, parentId: 'new:1' }])).verdicts[0].reason).toMatch(/never created/);
        expect((await one([{ op: 'create_folder', tempId: 'new:2', parentId: 'new:1', title: 'T' }, { op: 'create_folder', tempId: 'new:1', parentId: '1', title: 'S' }])).verdicts[0].reason).toMatch(/before its create_folder/);
        expect((await one([{ op: 'trash', id: a.id }, { op: 'move', id: x.id, parentId: a.id }])).verdicts[1].reason).toMatch(/goes to Trash/);
        expect((await one([{ op: 'trash', id: a.id }, { op: 'trash', id: b.id }])).verdicts[1].reason).toMatch(/inside a folder that already goes/);
        expect((await one([{ op: 'trash', id: x.id }, { op: 'rename', id: x.id, title: 'z' }])).verdicts[1].reason).toMatch(/also goes to Trash/);
        expect((await one([{ op: 'rename', id: x.id, title: 'p' }, { op: 'rename', id: x.id, title: 'q' }])).verdicts[1].reason).toMatch(/twice/);
        expect((await one([{ op: 'set_rating', id: x.id, rating: 0 }])).verdicts[0].reason).toMatch(/1 to 5/);
        expect((await one([{ op: 'set_tags', id: a.id, tags: ['t'] }])).verdicts[0].reason).toMatch(/Only bookmarks/);
        expect((await one([{ op: 'set_rating', id: x.id, rating: 4 }, { op: 'set_rating', id: y.id, rating: 2 }])).verdicts[1].reason).toMatch(/same link/);
        expect((await one([{ op: 'set_rating', id: x.id, rating: 4 }, { op: 'set_rating', id: y.id, rating: 4 }])).ok).toBe(true);
        expect((await one([{ op: 'rename', id: 'new:1', title: 'z' }])).verdicts[0].reason).toMatch(/only be a parent/);
    });

    it('simulates the combined effect: A into B then B into A is refused', async () => {
        const a = fakeBookmarks.seed('1', 'A');
        const b = fakeBookmarks.seed('1', 'B');
        const v = validateChangeSet(set([{ op: 'move', id: a.id, parentId: b.id }, { op: 'move', id: b.id, parentId: a.id }]), { roots: await tree(), hiddenFolderIds: new Set() });
        expect(v.verdicts[0].ok).toBe(true);
        expect(v.verdicts[1].reason).toMatch(/inside itself/);
    });

    it('caps the Trash impact at 1,000 nodes', async () => {
        const big = fakeBookmarks.seed('1', 'Big');
        for (let i = 0; i < 1000; i++) fakeBookmarks.seed(big.id, `b${i}`, `https://b${i}.example/`);
        const v = validateChangeSet(set([{ op: 'trash', id: big.id }]), { roots: await tree(), hiddenFolderIds: new Set() });
        expect(v.verdicts[0].reason).toMatch(/more than 1000/);
    });
});

describe('change sets: import, apply, undo', () => {
    beforeEach(() => { localStore['trashExternal'] = false; });

    it('applies the headline tidy-up as one step and one Undo restores everything', async () => {
        const research = fakeBookmarks.seed('1', 'Research');
        const keep = fakeBookmarks.seed(research.id, 'Keep folder');
        const items = Array.from({ length: 9 }, (_, i) => fakeBookmarks.seed(research.id, `Paper ${i}`, `https://p${i}.example/`));
        const old1 = fakeBookmarks.seed(research.id, 'Old 1', 'https://old1.example/');
        const old2 = fakeBookmarks.seed(research.id, 'Old 2', 'https://old2.example/');
        await storageIndex.patch('https://p0.example/', { tags: ['ml'] }, { title: 'Paper 0' });
        const before = await shape(research.id);
        const tagsBefore = (await storageIndex.get('https://p0.example/'))?.tags;

        const { cs } = svc();
        const ops: ChangeOp[] = [
            { op: 'create_folder', tempId: 'new:1', parentId: research.id, title: 'Papers' },
            ...items.map(n => ({ op: 'move' as const, id: n.id, parentId: 'new:1' })),
            { op: 'rename', id: items[0].id, title: 'Paper zero' },
            { op: 'rename', id: items[1].id, title: 'Paper one' },
            { op: 'rename', id: keep.id, title: 'Kept' },
            { op: 'set_tags', id: items[0].id, tags: ['ai', 'papers'] },
            { op: 'set_rating', id: items[1].id, rating: 5 },
            { op: 'trash', id: old1.id },
            { op: 'trash', id: old2.id },
        ];
        const imp = await cs.importText(text(ops), { kind: 'paste' });
        expect(imp.ok).toBe(true);
        const id = (imp as { id: string }).id;
        // Nothing has changed yet.
        expect(await shape(research.id)).toEqual(before);

        const res = await cs.apply(id, ops.map((_, n) => n));
        expect(res.ok).toBe(true);
        const got = await cs.get(id);
        expect(got.ok && got.set.state).toBe('applied');
        expect(got.ok && got.set.outcome).toEqual({ done: ops.length, skipped: 0 });
        expect(fakeBookmarks.titlesIn(research.id)).toEqual(['Kept', 'Papers']);
        expect((await storageIndex.get('https://p0.example/'))?.tags).toEqual(['ai', 'papers']);
        expect((await storageIndex.get('https://p1.example/'))?.rating).toBe(5);

        const undo = await cs.undo(id);
        expect(undo).toMatchObject({ ok: true, skipped: 0 });
        expect(await shape(research.id)).toEqual(before);
        expect((await storageIndex.get('https://p0.example/'))?.tags).toEqual(tagsBefore);
        expect((await storageIndex.get('https://p1.example/'))?.rating).toBeUndefined();
        const after = await cs.get(id);
        expect(after.ok && after.set.state).toBe('undone');
    });

    it('skips an item changed after review and never overwrites it on Undo', async () => {
        const f = fakeBookmarks.seed('1', 'F');
        const t = fakeBookmarks.seed('1', 'T');
        const x = fakeBookmarks.seed(f.id, 'X', 'https://x.example/');
        const y = fakeBookmarks.seed(f.id, 'Y', 'https://y.example/');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'move', id: x.id, parentId: t.id }, { op: 'rename', id: y.id, title: 'Y2' }]), { kind: 'paste' }) as { id: string };
        await chrome.bookmarks.update(y.id, { title: 'Y by user' });
        await cs.apply(imp.id, [0, 1]);
        const got = await cs.get(imp.id);
        const items = got.ok ? got.items : [];
        expect(items.map(i => i.state)).toEqual(['done', 'skipped']);
        expect(fakeBookmarks.titlesIn(f.id)).toEqual(['Y by user']);
        // The user moves X again; Undo leaves it.
        await chrome.bookmarks.move(x.id, { parentId: '2' });
        const u = await cs.undo(imp.id);
        expect(u.skipped).toBe(1);
        const after = await cs.get(imp.id);
        expect(after.ok && after.set.state).toBe('partly_undone');
    });

    it('keeps a folder whose contents grew after review (frozen Trash)', async () => {
        const f = fakeBookmarks.seed('1', 'Old stuff');
        fakeBookmarks.seed(f.id, 'A', 'https://a.example/');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'trash', id: f.id }]), { kind: 'paste' }) as { id: string };
        fakeBookmarks.seed(f.id, 'Added later', 'https://later.example/');
        await cs.apply(imp.id, [0]);
        const got = await cs.get(imp.id);
        expect(got.ok && got.items[0].state).toBe('skipped');
        expect(got.ok && got.items[0].reason).toMatch(/changed after you reviewed/);
        expect(fakeBookmarks.titlesIn(f.id)).toEqual(['A', 'Added later']);
    });

    it('undoes "move out, then trash the parent": the restored folder gets its child back', async () => {
        const parent = fakeBookmarks.seed('1', 'Parent');
        const keepMe = fakeBookmarks.seed(parent.id, 'Keep me', 'https://keep.example/');
        fakeBookmarks.seed(parent.id, 'Junk', 'https://junk.example/');
        const before = await shape('1');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'move', id: keepMe.id, parentId: '2' }, { op: 'trash', id: parent.id }]), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0, 1]);
        expect(fakeBookmarks.titlesIn('1')).not.toContain('Parent');
        expect(fakeBookmarks.titlesIn('2')).toContain('Keep me');
        const u = await cs.undo(imp.id);
        expect(u).toMatchObject({ ok: true, skipped: 0 });
        expect(await shape('1')).toEqual(before);
    });

    it('a skipped move keeps the folder it was leaving', async () => {
        const parent = fakeBookmarks.seed('1', 'Parent');
        const child = fakeBookmarks.seed(parent.id, 'Child', 'https://c.example/');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'move', id: child.id, parentId: '2' }, { op: 'trash', id: parent.id }]), { kind: 'paste' }) as { id: string };
        await chrome.bookmarks.move(child.id, { parentId: '1' }); // the user moved it meanwhile
        await chrome.bookmarks.move(child.id, { parentId: parent.id });
        await chrome.bookmarks.update(child.id, { title: 'Child' });
        // Simulate "moved since": put it somewhere else, so the move is skipped.
        const other = fakeBookmarks.seed('1', 'Other');
        await chrome.bookmarks.move(child.id, { parentId: other.id });
        await cs.apply(imp.id, [0, 1]);
        const got = await cs.get(imp.id);
        expect(got.ok && got.items.map(i => i.state)).toEqual(['skipped', 'skipped']);
        expect(fakeBookmarks.titlesIn('1')).toContain('Parent');
    });

    it('unticking a new folder blocks the moves into it', async () => {
        const x = fakeBookmarks.seed('1', 'X', 'https://x.example/');
        const { cs } = svc();
        const imp = await cs.importText(text([
            { op: 'create_folder', tempId: 'new:1', parentId: '1', title: 'New' },
            { op: 'move', id: x.id, parentId: 'new:1' },
        ]), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [1]);
        const got = await cs.get(imp.id);
        expect(got.ok && got.items[0]).toMatchObject({ state: 'skipped' });
        expect(fakeBookmarks.titlesIn('1')).toEqual(['X']);
    });

    it('resumes an interrupted apply: done, not applied, and Finish runs the rest', async () => {
        const t = fakeBookmarks.seed('2', 'T');
        const xs = [0, 1, 2].map(i => fakeBookmarks.seed('1', `X${i}`, `https://x${i}.example/`));
        const { cs } = svc();
        const imp = await cs.importText(text(xs.map(x => ({ op: 'move' as const, id: x.id, parentId: t.id }))), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0, 1, 2]);
        // Rewind to look like the worker stopped after item 0, mid item 1.
        await chrome.bookmarks.move(xs[2].id, { parentId: '1' });
        const r = localStore[csKey(imp.id)] as ChangeSetRecord;
        localStore[csKey(imp.id)] = { ...r, state: 'applying' };
        localStore[csjItemKey(imp.id, 1)] = { ...(localStore[csjItemKey(imp.id, 1)] as JournalItem), state: 'applying' };
        localStore[csjItemKey(imp.id, 2)] = { ...(localStore[csjItemKey(imp.id, 2)] as JournalItem), state: 'pending' };
        expect(await cs.recover()).toBe(1);
        let got = await cs.get(imp.id);
        expect(got.ok && got.set.state).toBe('partly_applied');
        expect(got.ok && got.items.map(i => i.state)).toEqual(['done', 'done', 'pending']);
        await cs.finish(imp.id);
        got = await cs.get(imp.id);
        expect(got.ok && got.set.state).toBe('applied');
        expect(fakeBookmarks.titlesIn(t.id)).toEqual(['X0', 'X1', 'X2']);
    });

    it('refuses a whole set with per-change reasons, and caps pending sets', async () => {
        const x = fakeBookmarks.seed('1', 'X', 'https://x.example/');
        const { cs } = svc();
        const bad = await cs.importText(text([{ op: 'rename', id: x.id, title: 'ok' }, { op: 'rename', id: '9999', title: 'no' }]), { kind: 'paste' });
        expect(bad.ok).toBe(false);
        expect(!bad.ok && bad.verdicts?.map(v => v.ok)).toEqual([true, false]);
        for (let i = 0; i < 10; i++) expect((await cs.importText(text([{ op: 'rename', id: x.id, title: `t${i}` }]), { kind: 'paste' })).ok).toBe(true);
        const eleventh = await cs.importText(text([{ op: 'rename', id: x.id, title: 'z' }]), { kind: 'paste' });
        expect(!eleventh.ok && eleventh.error).toMatch(/10 change sets waiting/);
    });

    it('expires a pending set after 24 hours and prunes decided sets after 30 days', async () => {
        const x = fakeBookmarks.seed('1', 'X', 'https://x.example/');
        const { cs, nowRef } = svc();
        const imp = await cs.importText(text([{ op: 'rename', id: x.id, title: 'Y' }]), { kind: 'paste' }) as { id: string };
        nowRef.t += 25 * 60 * 60 * 1000;
        const res = await cs.apply(imp.id, [0]);
        expect(res.error).toMatch(/expired/);
        nowRef.t += 31 * 24 * 60 * 60 * 1000;
        await cs.prune();
        expect(localStore[csKey(imp.id)]).toBeUndefined();
    });

    it('limits the scope of an answer to the folders the export shared', async () => {
        const shared = fakeBookmarks.seed('1', 'Shared');
        const other = fakeBookmarks.seed('1', 'Other', 'https://o.example/');
        const { cs } = svc();
        const snap = await cs.registerSnapshot([shared.id]);
        const r = await cs.importText(text([{ op: 'rename', id: other.id, title: 'x' }], { snapshotId: snap.snapshotId }), { kind: 'paste' });
        expect(r.ok).toBe(false);
    });

    it('new storage keys never look like legacy metadata and stay out of migration', async () => {
        const x = fakeBookmarks.seed('1', 'X', 'https://x.example/');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'rename', id: x.id, title: 'Y' }]), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0]);
        const keys = Object.keys(localStore).filter(k => k.startsWith('cs') );
        expect(keys.length).toBeGreaterThan(1);
        for (const k of keys) expect(isLegacyMetaRecord(k, localStore[k])).toBe(false);
        const snapshot = JSON.stringify(keys.map(k => localStore[k]));
        await migrateStorageSchema();
        expect(JSON.stringify(keys.map(k => localStore[k]))).toBe(snapshot);
    });

    it('review F1: Undo reverts a rename inside a folder the set trashed (new ids after restore)', async () => {
        const f = fakeBookmarks.seed('1', 'F');
        const b = fakeBookmarks.seed(f.id, 'Original', 'https://b.example/');
        const before = await shape('1');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'rename', id: b.id, title: 'AI name' }, { op: 'trash', id: f.id }]), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0, 1]);
        const u = await cs.undo(imp.id);
        expect(u).toMatchObject({ ok: true, skipped: 0 });
        expect(await shape('1')).toEqual(before);
    });

    it('review F2: a failing bookmarks call during Undo never leaves the set stuck', async () => {
        const b = fakeBookmarks.seed('1', 'Orig', 'https://r5.example/');
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'rename', id: b.id, title: 'New' }]), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0]);
        fakeBookmarks.failAfter('update', 0);
        const res = await cs.undo(imp.id);
        expect(res.ok).toBe(true);
        let got = await cs.get(imp.id);
        expect(got.ok && got.set.state).toBe('partly_undone');
        expect(got.ok && got.items[0].reason).toMatch(/Couldn't undo it/);
        // It can be tried again once the cause is gone.
        localStore[csjItemKey(imp.id, 0)] = { ...(localStore[csjItemKey(imp.id, 0)] as JournalItem), state: 'done' };
        await cs.undo(imp.id);
        got = await cs.get(imp.id);
        expect(fakeBookmarks.titlesIn('1')).toEqual(['Orig']);
    });

    it('review F3: an interrupted tag change keeps the original tags for Undo', async () => {
        const b = fakeBookmarks.seed('1', 'B', 'https://t.example/');
        await storageIndex.patch('https://t.example/', { tags: ['orig'] }, { title: 'B' });
        const { cs } = svc();
        const imp = await cs.importText(text([{ op: 'set_tags', id: b.id, tags: ['ai'] }]), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0]);
        const it = localStore[csjItemKey(imp.id, 0)] as JournalItem;
        expect(it.before?.tags).toEqual(['orig']);
        // The worker stopped after the write, before the item was marked done.
        localStore[csjItemKey(imp.id, 0)] = { ...it, state: 'applying' };
        localStore[csKey(imp.id)] = { ...(localStore[csKey(imp.id)] as ChangeSetRecord), state: 'applying' };
        await cs.recover();
        const got = await cs.get(imp.id);
        expect(got.ok && got.items[0].state).toBe('done');
        await cs.undo(imp.id);
        expect((await storageIndex.get('https://t.example/'))?.tags).toEqual(['orig']);
    });

    it('review F8: an interrupted Undo of a partly applied set keeps Finish available', async () => {
        const t = fakeBookmarks.seed('2', 'T');
        const xs = [0, 1].map(i => fakeBookmarks.seed('1', `X${i}`, `https://x${i}.example/`));
        const { cs } = svc();
        const imp = await cs.importText(text(xs.map(x => ({ op: 'move' as const, id: x.id, parentId: t.id }))), { kind: 'paste' }) as { id: string };
        await cs.apply(imp.id, [0, 1]);
        await chrome.bookmarks.move(xs[1].id, { parentId: '1' });
        localStore[csKey(imp.id)] = { ...(localStore[csKey(imp.id)] as ChangeSetRecord), state: 'undoing' };
        localStore[csjItemKey(imp.id, 1)] = { ...(localStore[csjItemKey(imp.id, 1)] as JournalItem), state: 'pending' };
        await cs.recover();
        const got = await cs.get(imp.id);
        expect(got.ok && got.set.state).toBe('partly_applied');
    });

    it('accepts messages only from extension pages, and not in incognito', async () => {
        const { cs } = svc();
        const m = { type: 'CS_LIST' as const };
        expect(await handleChangeSetMessage(cs, m, { url: 'https://evil.example/' }, false)).toMatchObject({ ok: false });
        expect(await handleChangeSetMessage(cs, m, { url: `${EXTENSION_ORIGIN}index.html` }, true)).toMatchObject({ ok: false });
        expect(await handleChangeSetMessage(cs, m, { url: `${EXTENSION_ORIGIN}index.html` }, false)).toMatchObject({ ok: true });
    });
});
