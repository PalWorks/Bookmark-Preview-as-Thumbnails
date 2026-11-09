// SPDX-License-Identifier: AGPL-3.0-only
//
// AI change sets in the service worker (docs/designs/agent-bridge.md, Stage 1;
// DECISIONS D18). The only place that applies, finishes or undoes a change set.
// One promise queue runs one job at a time; every item is journaled before it
// runs, so a worker that stops mid-apply leaves a set that Activity can finish or
// undo. Runs in the regular worker only. No import side effects: sw.ts creates the
// service and routes CS_* messages to it.
//
// Storage (never the legacy metadata shape, never in backups):
//   cs_<id>        the set as received, its verdicts, approval and state
//   csj_<id>       journal header
//   csj_<id>_<k>   one journal item per change
//   cssnap_<id>    the folders an export shared (scope for the answer)

import { getNode, isManaged, type BookmarkNode } from '../lib/bookmark_tree';
import { listLocalKeys } from '../lib/trash_store';
import { hiddenFolderIds, readFolderPrefs } from '../lib/folder_prefs';
import { cleanTags } from '../lib/metadata_sanitize';
import { storageIndex as defaultStorageIndex, type StorageIndex } from '../lib/storage_index';
import type { TrashService } from './trash';
import {
    MAX_PENDING_SETS, PENDING_TTL_MS, isTempId, parseChangeSet,
    type ChangeOp, type ChangeSetInput, type OpKind,
} from '../lib/change_set/format';
import { validateChangeSet, type OpBaseline, type OpVerdict } from '../lib/change_set/validate';

export const CS_PREFIX = 'cs_';
export const CSJ_PREFIX = 'csj_';
export const SNAP_PREFIX = 'cssnap_';
export const CS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_KEPT_JOURNALS = 50;
const SNAP_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export type SetState =
    | 'pending' | 'applying' | 'partly_applied' | 'applied'
    | 'rejected' | 'expired' | 'undoing' | 'partly_undone' | 'undone';

export type ItemState = 'pending' | 'applying' | 'done' | 'skipped' | 'undoing' | 'undone' | 'undo_skipped';

export interface ChangeSetSource {
    kind: 'paste' | 'file' | 'agent';
    /** File name, or the agent's name (Stage 2). */
    name?: string;
}

export interface ChangeSetRecord {
    v: 1;
    id: string;
    createdAt: number;
    updatedAt: number;
    source: ChangeSetSource;
    title?: string;
    snapshotId?: string;
    /** False when the set did not answer an export of this browser (no scope known). */
    scoped: boolean;
    /** Paired coding agent that proposed it (Stage 2). */
    clientId?: string;
    ops: ChangeOp[];
    verdicts: OpVerdict[];
    order: number[];
    state: SetState;
    decidedAt?: number;
    approval?: { at: number; selected: number[] };
    /** Journal dropped (retention cap): Activity keeps the row, Undo is gone. */
    undoAvailable: boolean;
    outcome?: { done: number; skipped: number; undone?: number; undoSkipped?: number };
}

export interface JournalItem {
    k: number;
    /** Index of the change in the set. */
    n: number;
    kind: OpKind;
    state: ItemState;
    before?: { parentId?: string; index?: number; title?: string; tags?: string[]; rating?: number | null };
    after?: { parentId?: string; index?: number; title?: string; tags?: string[]; rating?: number | null };
    reason?: string;
    /** create_folder: when it started (resume matches by dateAdded) and the id it got. */
    intentAt?: number;
    createdId?: string;
    url?: string;
    /** trash: the Trash operation and entry that hold it. */
    trashOperationId?: string;
    trashEntryId?: string;
    /** trash Undo: old id to new id after restore. */
    idMap?: Record<string, string>;
}

export interface JournalHeader {
    setId: string;
    count: number;
    startedAt: number;
    lastProgressAt: number;
}

export interface ChangeSetSummary {
    id: string;
    createdAt: number;
    decidedAt?: number;
    source: ChangeSetSource;
    title?: string;
    state: SetState;
    counts: Partial<Record<OpKind, number>>;
    refused: number;
    undoAvailable: boolean;
    outcome?: ChangeSetRecord['outcome'];
}

export interface ChangeSetsDeps {
    trash: TrashService;
    storageIndex?: StorageIndex;
    broadcast?: (message: { type: 'CS_CHANGED'; id?: string }) => void;
    now?: () => number;
    uuid?: () => string;
    /** Kinds this build applies (1a ships create_folder, move, rename). */
    allowedKinds?: Set<OpKind>;
}

export const csKey = (id: string) => `${CS_PREFIX}${id}`;
export const csjKey = (id: string) => `${CSJ_PREFIX}${id}`;
export const csjItemKey = (id: string, k: number) => `${CSJ_PREFIX}${id}_${k}`;
export const snapKey = (id: string) => `${SNAP_PREFIX}${id}`;

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function counts(ops: ChangeOp[]): Partial<Record<OpKind, number>> {
    const c: Partial<Record<OpKind, number>> = {};
    for (const op of ops) c[op.op] = (c[op.op] ?? 0) + 1;
    return c;
}

export function summarize(r: ChangeSetRecord): ChangeSetSummary {
    return {
        id: r.id, createdAt: r.createdAt, decidedAt: r.decidedAt, source: r.source, title: r.title,
        state: r.state, counts: counts(r.ops), refused: r.verdicts.filter(v => !v.ok).length,
        undoAvailable: r.undoAvailable, outcome: r.outcome,
    };
}

const sameTags = (a: string[] | undefined, b: string[] | undefined) =>
    JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

export function createChangeSetsService(deps: ChangeSetsDeps) {
    const { trash } = deps;
    const index = deps.storageIndex ?? defaultStorageIndex;
    const now = deps.now ?? (() => Date.now());
    const uuid = deps.uuid ?? (() => crypto.randomUUID());
    const broadcast = deps.broadcast ?? ((m) => { chrome.runtime.sendMessage(m).catch(() => { /* no page open */ }); });
    const allowedKinds = deps.allowedKinds;

    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
        const run = queue.then(job, job);
        queue = run.catch(() => undefined);
        return run;
    };

    // ── Storage helpers ─────────────────────────────────────────────────────

    async function readSet(id: string): Promise<ChangeSetRecord | undefined> {
        const got = await chrome.storage.local.get(csKey(id));
        return got[csKey(id)] as ChangeSetRecord | undefined;
    }

    async function writeSet(r: ChangeSetRecord): Promise<void> {
        r.updatedAt = now();
        await chrome.storage.local.set({ [csKey(r.id)]: r });
    }

    async function readJournal(id: string): Promise<{ header?: JournalHeader; items: JournalItem[] }> {
        const head = (await chrome.storage.local.get(csjKey(id)))[csjKey(id)] as JournalHeader | undefined;
        if (!head) return { items: [] };
        const keys = Array.from({ length: head.count }, (_, k) => csjItemKey(id, k));
        const got = keys.length ? await chrome.storage.local.get(keys) : {};
        const items = keys.map(k => got[k] as JournalItem | undefined).filter((x): x is JournalItem => !!x);
        return { header: head, items };
    }

    async function writeItem(setId: string, item: JournalItem): Promise<void> {
        await chrome.storage.local.set({ [csjItemKey(setId, item.k)]: item });
    }

    async function allSetIds(): Promise<string[]> {
        const keys = await listLocalKeys();
        return keys.filter(k => k.startsWith(CS_PREFIX)).map(k => k.slice(CS_PREFIX.length));
    }

    async function readAll(): Promise<ChangeSetRecord[]> {
        const ids = await allSetIds();
        if (!ids.length) return [];
        const got = await chrome.storage.local.get(ids.map(csKey));
        return ids.map(id => got[csKey(id)] as ChangeSetRecord | undefined).filter((r): r is ChangeSetRecord => !!r && r.v === 1);
    }

    async function dropJournal(id: string): Promise<void> {
        const head = (await chrome.storage.local.get(csjKey(id)))[csjKey(id)] as JournalHeader | undefined;
        const keys = [csjKey(id)];
        if (head) for (let k = 0; k < head.count; k++) keys.push(csjItemKey(id, k));
        await chrome.storage.local.remove(keys);
    }

    async function hidden(): Promise<Set<string>> {
        return hiddenFolderIds(await readFolderPrefs());
    }

    // ── Export scope ────────────────────────────────────────────────────────

    async function registerSnapshot(folderIds: string[]): Promise<{ ok: true; snapshotId: string }> {
        const snapshotId = uuid();
        await chrome.storage.local.set({ [snapKey(snapshotId)]: { folderIds, createdAt: now() } });
        return { ok: true, snapshotId };
    }

    async function scopeFor(snapshotId: string | undefined): Promise<Set<string> | undefined> {
        if (!snapshotId) return undefined;
        const snap = (await chrome.storage.local.get(snapKey(snapshotId)))[snapKey(snapshotId)] as { folderIds?: string[] } | undefined;
        return snap?.folderIds ? new Set(snap.folderIds) : undefined;
    }

    // ── Import ──────────────────────────────────────────────────────────────

    async function importNow(text: string, source: ChangeSetSource, opts: { scopeFolderIds?: Set<string>; clientId?: string; maxPendingForClient?: number } = {}): Promise<
        { ok: true; id: string } | { ok: false; error: string; verdicts?: OpVerdict[]; ops?: ChangeOp[] }
    > {
        const parsed = parseChangeSet(text);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const set: ChangeSetInput = parsed.set;
        const pending = (await readAll()).filter(r => r.state === 'pending');
        if (pending.length >= MAX_PENDING_SETS) {
            return { ok: false, error: `You already have ${MAX_PENDING_SETS} change sets waiting. Apply or reject one in AI changes first.` };
        }
        if (opts.clientId && opts.maxPendingForClient !== undefined && pending.filter(r => r.clientId === opts.clientId).length >= opts.maxPendingForClient) {
            return { ok: false, error: `This agent already has ${opts.maxPendingForClient} change sets waiting for review.` };
        }
        const scope = opts.scopeFolderIds ?? await scopeFor(set.snapshotId);
        const roots = await chrome.bookmarks.getTree();
        const v = validateChangeSet(set, { roots, hiddenFolderIds: await hidden(), scopeFolderIds: scope, allowedKinds });
        if (!v.ok) {
            const refused = v.verdicts.filter(x => !x.ok).length;
            return { ok: false, error: `${refused} of ${set.ops.length} changes can't be made, so nothing was added. Fix them or ask the AI again.`, verdicts: v.verdicts, ops: set.ops };
        }
        const id = uuid();
        const record: ChangeSetRecord = {
            v: 1, id, createdAt: now(), updatedAt: now(), source, title: set.title, snapshotId: set.snapshotId,
            scoped: !!scope, ...(opts.clientId ? { clientId: opts.clientId } : {}), ops: set.ops, verdicts: v.verdicts, order: v.order, state: 'pending', undoAvailable: true,
        };
        await writeSet(record);
        broadcast({ type: 'CS_CHANGED', id });
        return { ok: true, id };
    }

    // ── Apply ───────────────────────────────────────────────────────────────

    /** Which of the selected changes can run: dependencies must be selected too. */
    function closure(r: ChangeSetRecord, selected: Set<number>): Map<number, string> {
        const blocked = new Map<number, string>();
        let changed = true;
        while (changed) {
            changed = false;
            for (const n of selected) {
                if (blocked.has(n)) continue;
                const deps = r.verdicts[n].dependsOn ?? [];
                const missing = deps.find(d => !selected.has(d) || blocked.has(d));
                if (missing !== undefined) {
                    const op = r.ops[missing];
                    blocked.set(n, `Its new folder "${op.op === 'create_folder' ? op.title : ''}" was not selected.`);
                    changed = true;
                }
            }
        }
        return blocked;
    }

    function intendedAfter(op: ChangeOp): JournalItem['after'] {
        switch (op.op) {
            case 'move': return { parentId: op.parentId, index: op.index };
            case 'rename': return { title: op.title };
            case 'set_tags': return { tags: cleanTags(op.tags) ?? [] };
            case 'set_rating': return { rating: op.rating };
            default: return undefined;
        }
    }

    function beforeOf(b: OpBaseline | undefined): JournalItem['before'] {
        if (!b) return undefined;
        return { parentId: b.parentId, index: b.index, title: b.title };
    }

    async function applyNow(id: string, selectedRaw: number[]): Promise<{ ok: boolean; error?: string }> {
        const r = await readSet(id);
        if (!r) return { ok: false, error: 'That change set no longer exists.' };
        if (r.state !== 'pending') return { ok: false, error: 'That change set was already decided.' };
        if (r.createdAt + PENDING_TTL_MS < now()) {
            r.state = 'expired'; r.decidedAt = now(); await writeSet(r); broadcast({ type: 'CS_CHANGED', id });
            return { ok: false, error: 'That change set expired after 24 hours. Import it again to review it.' };
        }
        const selected = new Set(selectedRaw.filter(n => Number.isInteger(n) && n >= 0 && n < r.ops.length && r.verdicts[n].ok));
        if (selected.size === 0) return { ok: false, error: 'Tick at least one change to apply.' };
        const blocked = closure(r, selected);

        // The approval record is stored before the first change.
        r.approval = { at: now(), selected: [...selected].sort((a, b) => a - b) };
        r.state = 'applying';
        r.decidedAt = now();
        const order = r.order.filter(n => selected.has(n));
        const items: JournalItem[] = order.map((n, k) => {
            const op = r.ops[n];
            const v = r.verdicts[n];
            const item: JournalItem = { k, n, kind: op.op, state: 'pending', before: beforeOf(v.baseline), after: intendedAfter(op) };
            if (v.baseline?.url) item.url = v.baseline.url;
            if (blocked.has(n)) { item.state = 'skipped'; item.reason = blocked.get(n); }
            return item;
        });
        const header: JournalHeader = { setId: id, count: items.length, startedAt: now(), lastProgressAt: now() };
        const write: Record<string, unknown> = { [csKey(id)]: { ...r, updatedAt: now() }, [csjKey(id)]: header };
        for (const it of items) write[csjItemKey(id, it.k)] = it;
        await chrome.storage.local.set(write);
        broadcast({ type: 'CS_CHANGED', id });

        await runItems(r, items);
        return { ok: true };
    }

    /** Run every pending item, in journal order (= apply order). Used by Apply and Finish. */
    async function runItems(r: ChangeSetRecord, items: JournalItem[]): Promise<void> {
        const tempIds = new Map<string, string>();
        for (const it of items) {
            const op = r.ops[it.n];
            if (op.op === 'create_folder' && it.createdId) tempIds.set(op.tempId, it.createdId);
        }
        const resolve = (pid: string) => (isTempId(pid) ? tempIds.get(pid) : pid);
        const hiddenIds = await hidden();

        const runOne = async (it: JournalItem): Promise<void> => {
            const op = r.ops[it.n];
            it.state = 'applying';
            if (op.op === 'create_folder') it.intentAt = now();
            await writeItem(r.id, it);
            try {
                const reason = await execute(op, it, resolve, hiddenIds);
                if (reason) { it.state = 'skipped'; it.reason = reason; }
                else it.state = 'done';
                if (op.op === 'create_folder' && it.createdId) tempIds.set(op.tempId, it.createdId);
            } catch (err) {
                it.state = 'skipped';
                it.reason = message(err);
            }
            await writeItem(r.id, it);
        };

        // Everything but Trash, one at a time.
        for (const it of items) {
            if (it.state !== 'pending' || it.kind === 'trash') continue;
            await runOne(it);
        }
        // Trash last, as one batch (one Trash operation for the set).
        const trashItems = items.filter(it => it.state === 'pending' && it.kind === 'trash');
        if (trashItems.length) await runTrash(r, items, trashItems);

        await finishState(r, items);
    }

    /** Perform one non-Trash change. Returns a reason when it was skipped. */
    async function execute(
        op: ChangeOp, it: JournalItem, resolve: (pid: string) => string | undefined, hiddenIds: Set<string>,
    ): Promise<string | undefined> {
        const isHidden = async (node: BookmarkNode): Promise<boolean> => {
            let cur: BookmarkNode | undefined = node;
            let guard = 0;
            while (cur && guard++ < 512) {
                if (hiddenIds.has(cur.id)) return true;
                cur = cur.parentId ? await getNode(cur.parentId) : undefined;
            }
            return false;
        };
        switch (op.op) {
            case 'create_folder': {
                const pid = resolve(op.parentId);
                const parent = pid ? await getNode(pid) : undefined;
                if (!parent || parent.url || isManaged(parent)) return 'Its parent folder is gone.';
                const created = await chrome.bookmarks.create({ parentId: parent.id, title: op.title });
                it.createdId = created.id;
                it.after = { parentId: parent.id, title: op.title };
                return undefined;
            }
            case 'move': {
                const node = await getNode(op.id);
                if (!node) return 'It no longer exists.';
                if (node.parentId !== it.before?.parentId) return 'It was moved after you reviewed it, so it was left where it is.';
                if (await isHidden(node)) return 'It is now in a folder hidden from search.';
                const tid = resolve(op.parentId);
                const target = tid ? await getNode(tid) : undefined;
                if (!target || target.url || isManaged(target)) return 'The target folder is gone.';
                const count = (await chrome.bookmarks.getChildren(target.id)).length;
                const details: { parentId: string; index?: number } = { parentId: target.id };
                if (op.index !== undefined) details.index = Math.min(op.index, count);
                const moved = await chrome.bookmarks.move(op.id, details);
                it.after = { parentId: target.id, index: moved.index };
                return undefined;
            }
            case 'rename': {
                const node = await getNode(op.id);
                if (!node) return 'It no longer exists.';
                if (node.title !== it.before?.title) return 'It was renamed after you reviewed it, so its name was kept.';
                await chrome.bookmarks.update(op.id, { title: op.title });
                return undefined;
            }
            case 'set_tags':
            case 'set_rating': {
                const node = await getNode(op.id);
                if (!node?.url || node.url !== it.url) return 'It no longer exists, or its link changed.';
                const url = node.url;
                await index.update(url, existing => {
                    if (op.op === 'set_tags') {
                        it.before = { tags: existing?.tags ? [...existing.tags] : [] };
                        return { tags: it.after!.tags };
                    }
                    it.before = { rating: existing?.rating ?? null };
                    return { rating: op.rating === null ? undefined : op.rating };
                });
                chrome.runtime.sendMessage({ type: 'META_UPDATED', urls: [url] }).catch(() => undefined);
                return undefined;
            }
            default:
                return 'Not available.';
        }
    }

    async function runTrash(r: ChangeSetRecord, all: JournalItem[], trashItems: JournalItem[]): Promise<void> {
        const hiddenIds = await hidden();
        // Items this set moved out of a folder before trashing it are expected to be gone from it.
        const movedOut = new Set(all.filter(i => i.kind === 'move' && i.state === 'done').map(i => (r.ops[i.n] as { id: string }).id));
        // A move that was skipped left its item inside the folder it was leaving: keep that folder.
        const keptByMove = all.filter(i => i.kind === 'move' && i.state === 'skipped').map(i => i.before?.parentId);
        const expectedSubtrees: Record<string, string[]> = {};
        const run: JournalItem[] = [];
        for (const it of trashItems) {
            const op = r.ops[it.n] as { op: 'trash'; id: string };
            const frozen = r.verdicts[it.n].baseline?.descendantIds ?? [op.id];
            // Anything moved out of this folder, and anything under it, left with the move.
            const leaving = new Set<string>();
            const stillThere = frozen.filter(x => !movedOut.has(x));
            for (const x of frozen) if (movedOut.has(x)) leaving.add(x);
            const subtreeOfMoved = (await Promise.all([...leaving].map(async x => {
                const sub = (await chrome.bookmarks.getSubTree(x).catch(() => []))[0];
                const ids: string[] = [];
                const walk = (n?: BookmarkNode) => { if (!n) return; ids.push(n.id); (n.children ?? []).forEach(walk); };
                walk(sub);
                return ids;
            }))).flat();
            const expected = stillThere.filter(x => !subtreeOfMoved.includes(x));
            if (keptByMove.some(p => p && frozen.includes(p))) {
                it.state = 'skipped';
                it.reason = 'A move out of this folder was skipped, so the folder was kept.';
                await writeItem(r.id, it);
                continue;
            }
            if (expected.some(x => hiddenIds.has(x))) {
                it.state = 'skipped';
                it.reason = 'It now contains a folder hidden from search, so it was kept.';
                await writeItem(r.id, it);
                continue;
            }
            expectedSubtrees[op.id] = expected;
            it.state = 'applying';
            await writeItem(r.id, it);
            run.push(it);
        }
        if (!run.length) return;
        const ids = run.map(it => (r.ops[it.n] as { id: string }).id);
        let res;
        try {
            res = await trash.deleteItems({ ids, requestId: `cs_${r.id}`, origin: 'ai-changes', expectedSubtrees });
        } catch (err) {
            for (const it of run) { it.state = 'skipped'; it.reason = message(err); await writeItem(r.id, it); }
            return;
        }
        const entries = res.operationId ? await entriesOf(res.operationId) : [];
        for (const it of run) {
            const id = (r.ops[it.n] as { id: string }).id;
            const entry = entries.find(e => e.oldId === id);
            const rejected = res.rejected?.find(x => x.id === id);
            const failed = res.failed?.find(x => x.id === id);
            if (entry) {
                it.state = 'done';
                it.trashOperationId = res.operationId;
                it.trashEntryId = entry.entryId;
            } else {
                it.state = 'skipped';
                it.reason = rejected?.reason === 'changed'
                    ? 'Its contents changed after you reviewed it, so it was kept.'
                    : rejected ? "Chrome's own or a managed folder; it was kept."
                        : failed?.error ?? res.error ?? 'It was not moved to Trash.';
            }
            await writeItem(r.id, it);
        }
    }

    async function entriesOf(operationId: string): Promise<Array<{ entryId: string; oldId: string }>> {
        const keys = (await listLocalKeys()).filter(k => k.startsWith('trash_v1_'));
        if (!keys.length) return [];
        const got = await chrome.storage.local.get(keys);
        return Object.values(got)
            .filter((e): e is { entryId: string; operationId: string; tree: { oldId: string } } =>
                !!e && typeof e === 'object' && (e as { operationId?: string }).operationId === operationId)
            .map(e => ({ entryId: e.entryId, oldId: e.tree.oldId }));
    }

    async function finishState(r: ChangeSetRecord, items: JournalItem[]): Promise<void> {
        const done = items.filter(i => i.state === 'done').length;
        const skipped = items.filter(i => i.state === 'skipped').length;
        const left = items.filter(i => i.state === 'pending' || i.state === 'applying').length;
        r.state = left ? 'partly_applied' : 'applied';
        r.outcome = { done, skipped };
        await chrome.storage.local.set({ [csjKey(r.id)]: { setId: r.id, count: items.length, startedAt: r.approval?.at ?? now(), lastProgressAt: now() } satisfies JournalHeader });
        await writeSet(r);
        broadcast({ type: 'CS_CHANGED', id: r.id });
    }

    async function finishNow(id: string): Promise<{ ok: boolean; error?: string }> {
        const r = await readSet(id);
        if (!r || r.state !== 'partly_applied') return { ok: false, error: 'There is nothing left to finish.' };
        const { items } = await readJournal(id);
        r.state = 'applying';
        await writeSet(r);
        broadcast({ type: 'CS_CHANGED', id });
        await runItems(r, items);
        return { ok: true };
    }

    // ── Undo ────────────────────────────────────────────────────────────────

    async function undoNow(id: string): Promise<{ ok: boolean; error?: string; undone?: number; skipped?: number }> {
        const r = await readSet(id);
        if (!r) return { ok: false, error: 'That change set no longer exists.' };
        if (!r.undoAvailable) return { ok: false, error: 'Undo is no longer available for this change set.' };
        if (r.state !== 'applied' && r.state !== 'partly_applied' && r.state !== 'partly_undone') return { ok: false, error: 'There is nothing to undo.' };
        const { items } = await readJournal(id);
        r.state = 'undoing';
        await writeSet(r);
        broadcast({ type: 'CS_CHANGED', id });

        const idMap = new Map<string, string>();
        for (const it of items) for (const [a, b] of Object.entries(it.idMap ?? {})) idMap.set(a, b);
        const mapId = (x: string | undefined) => (x ? idMap.get(x) ?? x : x);
        const mark = async (it: JournalItem, state: ItemState, reason?: string) => {
            it.state = state;
            if (reason) it.reason = reason; else delete it.reason;
            await writeItem(id, it);
        };
        const todo = (kind: OpKind) => items.filter(i => i.kind === kind && (i.state === 'done' || i.state === 'undoing'));

        // Reverse apply order: Trash, metadata, renames, moves, created folders.
        const trashItems = todo('trash');
        const ops = [...new Set(trashItems.map(i => i.trashOperationId).filter((x): x is string => !!x))];
        for (const operationId of ops) {
            const group = trashItems.filter(i => i.trashOperationId === operationId);
            for (const it of group) { it.state = 'undoing'; await writeItem(id, it); }
            const res = await trash.restore({ operationId });
            for (const it of group) {
                const one = res.results?.find(x => x.entryId === it.trashEntryId);
                if (one?.state === 'restored') {
                    it.idMap = one.restoredTo?.idMap ?? {};
                    for (const [a, b] of Object.entries(it.idMap)) idMap.set(a, b);
                    await mark(it, 'undone');
                } else {
                    await mark(it, 'undo_skipped', one?.error ?? res.error ?? 'It is no longer in Trash.');
                }
            }
        }

        for (const it of [...todo('set_tags'), ...todo('set_rating')].reverse()) {
            const url = it.url;
            if (!url) { await mark(it, 'undo_skipped', 'Unknown link.'); continue; }
            const result = { undone: false };
            await index.update(url, existing => {
                if (it.kind === 'set_tags') {
                    if (!sameTags(existing?.tags, it.after?.tags)) return undefined;
                    result.undone = true;
                    return { tags: it.before?.tags?.length ? it.before.tags : undefined };
                }
                if ((existing?.rating ?? null) !== (it.after?.rating ?? null)) return undefined;
                result.undone = true;
                return { rating: it.before?.rating ?? undefined };
            });
            if (result.undone) {
                chrome.runtime.sendMessage({ type: 'META_UPDATED', urls: [url] }).catch(() => undefined);
                await mark(it, 'undone');
            } else await mark(it, 'undo_skipped', 'Changed again since, so the newer value was kept.');
        }

        for (const it of todo('rename').reverse()) {
            const op = r.ops[it.n] as { op: 'rename'; id: string };
            const node = await getNode(op.id);
            if (!node) { await mark(it, 'undo_skipped', 'It no longer exists.'); continue; }
            if (node.title !== it.after?.title) { await mark(it, 'undo_skipped', 'Renamed again since, so the newer name was kept.'); continue; }
            await chrome.bookmarks.update(op.id, { title: it.before?.title ?? '' });
            await mark(it, 'undone');
        }

        // Moves: per original folder, lowest original position first (as undoMoves does).
        const moves = todo('move').sort((a, b) => (a.before?.parentId ?? '').localeCompare(b.before?.parentId ?? '') || (a.before?.index ?? 0) - (b.before?.index ?? 0));
        const skippedPer = new Map<string, number>();
        for (const it of moves) {
            const op = r.ops[it.n] as { op: 'move'; id: string };
            const origParent = mapId(it.before?.parentId);
            const node = await getNode(op.id);
            const parent = origParent ? await getNode(origParent) : undefined;
            const bump = () => skippedPer.set(it.before?.parentId ?? '', (skippedPer.get(it.before?.parentId ?? '') ?? 0) + 1);
            if (!node || !parent || parent.url) { bump(); await mark(it, 'undo_skipped', 'It, or the folder it came from, is gone.'); continue; }
            if (node.parentId !== mapId(it.after?.parentId)) { bump(); await mark(it, 'undo_skipped', 'Moved again since, so it was left where it is.'); continue; }
            const count = (await chrome.bookmarks.getChildren(parent.id)).length;
            const at = Math.max(0, (it.before?.index ?? 0) - (skippedPer.get(it.before?.parentId ?? '') ?? 0));
            await chrome.bookmarks.move(op.id, { parentId: parent.id, index: Math.min(at, count) });
            await mark(it, 'undone');
        }

        // Created folders go (through Trash) only if untouched and empty.
        const creates = todo('create_folder').reverse();
        const removable: JournalItem[] = [];
        for (const it of creates) {
            const node = it.createdId ? await getNode(it.createdId) : undefined;
            if (!node) { await mark(it, 'undone'); continue; }
            if (node.title !== it.after?.title) { await mark(it, 'undo_skipped', 'Renamed since, so the folder was kept.'); continue; }
            const children = await chrome.bookmarks.getChildren(node.id);
            const createdChild = children.every(c => removable.some(x => x.createdId === c.id));
            if (children.length && !createdChild) { await mark(it, 'undo_skipped', 'It holds items added since, so the folder was kept.'); continue; }
            removable.push(it);
        }
        // Remove only the outermost created folders; nested created ones go with them.
        const outer = removable.filter(it => !removable.some(o => o !== it && o.createdId === (it.after?.parentId)));
        if (outer.length) {
            const res = await trash.deleteItems({ ids: outer.map(o => o.createdId!), origin: 'ai-changes' });
            for (const it of removable) {
                const failed = res.failed?.some(f => f.id === it.createdId) || res.rejected?.some(f => f.id === it.createdId);
                if (failed) await mark(it, 'undo_skipped', "The folder couldn't be removed.");
                else await mark(it, 'undone');
            }
        }

        const undone = items.filter(i => i.state === 'undone').length;
        const undoSkipped = items.filter(i => i.state === 'undo_skipped').length;
        const stillDone = items.filter(i => i.state === 'done' || i.state === 'undoing').length;
        r.state = undoSkipped || stillDone ? 'partly_undone' : 'undone';
        r.outcome = { ...(r.outcome ?? { done: 0, skipped: 0 }), undone, undoSkipped };
        await writeSet(r);
        broadcast({ type: 'CS_CHANGED', id });
        return { ok: true, undone, skipped: undoSkipped };
    }

    // ── Reject, list, get ───────────────────────────────────────────────────

    async function rejectNow(id: string): Promise<{ ok: boolean; error?: string }> {
        const r = await readSet(id);
        if (!r || r.state !== 'pending') return { ok: false, error: 'That change set was already decided.' };
        r.state = 'rejected';
        r.decidedAt = now();
        await writeSet(r);
        broadcast({ type: 'CS_CHANGED', id });
        return { ok: true };
    }

    async function listNow(): Promise<ChangeSetSummary[]> {
        const all = await readAll();
        for (const r of all) {
            if (r.state === 'pending' && r.createdAt + PENDING_TTL_MS < now()) {
                r.state = 'expired';
                r.decidedAt = now();
                await writeSet(r);
            }
        }
        return all.sort((a, b) => b.createdAt - a.createdAt).map(summarize);
    }

    async function getNow(id: string): Promise<{ ok: true; set: ChangeSetRecord; items: JournalItem[] } | { ok: false; error: string }> {
        const r = await readSet(id);
        if (!r) return { ok: false, error: 'That change set no longer exists.' };
        const { items } = await readJournal(id);
        return { ok: true, set: r, items };
    }

    // ── Recovery and retention ──────────────────────────────────────────────

    /**
     * A fresh worker has no job running, so any set left mid-apply or mid-undo was
     * interrupted. Items caught mid-change are compared with the tree.
     */
    async function recoverNow(): Promise<number> {
        let fixed = 0;
        for (const r of await readAll()) {
            if (r.state !== 'applying' && r.state !== 'undoing') continue;
            const { items } = await readJournal(r.id);
            for (const it of items) {
                if (it.state === 'applying') await classifyApplying(r, it, items);
                if (it.state === 'undoing') { it.state = 'done'; await writeItem(r.id, it); }
            }
            const left = items.some(i => i.state === 'pending');
            const done = items.filter(i => i.state === 'done').length;
            const skipped = items.filter(i => i.state === 'skipped').length;
            if (r.state === 'applying') { r.state = left ? 'partly_applied' : 'applied'; r.outcome = { done, skipped }; }
            else r.state = items.some(i => i.state === 'undone') ? 'partly_undone' : 'applied';
            await writeSet(r);
            fixed++;
        }
        if (fixed) broadcast({ type: 'CS_CHANGED' });
        return fixed;
    }

    async function classifyApplying(r: ChangeSetRecord, it: JournalItem, items: JournalItem[]): Promise<void> {
        const op = r.ops[it.n];
        const set = async (state: ItemState, reason?: string) => { it.state = state; if (reason) it.reason = reason; await writeItem(r.id, it); };
        switch (op.op) {
            case 'create_folder': {
                if (it.createdId) return set('done');
                const parentId = isTempId(op.parentId)
                    ? items.find(x => { const o = r.ops[x.n]; return o.op === 'create_folder' && o.tempId === op.parentId; })?.createdId
                    : op.parentId;
                const children = parentId ? await chrome.bookmarks.getChildren(parentId).catch(() => []) : [];
                const matches = children.filter(c => !c.url && c.title === op.title && (c.dateAdded ?? 0) >= (it.intentAt ?? 0) - 2000);
                if (matches.length === 1) { it.createdId = matches[0].id; it.after = { parentId, title: op.title }; return set('done'); }
                if (matches.length === 0) return set('pending');
                return set('skipped', 'Interrupted while creating it; check this folder yourself.');
            }
            case 'move': {
                const node = await getNode(op.id);
                if (node && node.parentId === it.before?.parentId) return set('pending');
                if (node && it.after?.parentId && !isTempId(it.after.parentId) && node.parentId === it.after.parentId) { it.after.index = node.index; return set('done'); }
                return set('skipped', 'Interrupted and changed since.');
            }
            case 'rename': {
                const node = await getNode(op.id);
                if (node?.title === it.after?.title) return set('done');
                if (node?.title === it.before?.title) return set('pending');
                return set('skipped', 'Interrupted and changed since.');
            }
            case 'trash':
                // Finish repeats the same Trash request id, which resumes or returns the stored result.
                return set('pending');
            default:
                return set('pending');
        }
    }

    async function pruneNow(): Promise<number> {
        const all = await readAll();
        const t = now();
        let removed = 0;
        for (const r of all) {
            if (r.state === 'pending' && r.createdAt + PENDING_TTL_MS < t) { r.state = 'expired'; r.decidedAt = t; await writeSet(r); }
            const age = t - (r.decidedAt ?? r.createdAt);
            if (r.state !== 'pending' && r.state !== 'applying' && r.state !== 'undoing' && age > CS_RETENTION_MS) {
                await dropJournal(r.id);
                await chrome.storage.local.remove(csKey(r.id));
                removed++;
            }
        }
        const withJournal = (await readAll())
            .filter(r => r.undoAvailable && r.approval)
            .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
        for (const r of withJournal.slice(MAX_KEPT_JOURNALS)) {
            await dropJournal(r.id);
            r.undoAvailable = false;
            await writeSet(r);
        }
        const snaps = (await listLocalKeys()).filter(k => k.startsWith(SNAP_PREFIX));
        if (snaps.length) {
            const got = await chrome.storage.local.get(snaps);
            const old = snaps.filter(k => ((got[k] as { createdAt?: number })?.createdAt ?? 0) + SNAP_KEEP_MS < t);
            if (old.length) await chrome.storage.local.remove(old);
        }
        if (removed) broadcast({ type: 'CS_CHANGED' });
        return removed;
    }

    return {
        registerSnapshot: (folderIds: string[]) => enqueue(() => registerSnapshot(folderIds)),
        importText: (text: string, source: ChangeSetSource, opts?: { scopeFolderIds?: Set<string>; clientId?: string; maxPendingForClient?: number }) => enqueue(() => importNow(text, source, opts)),
        apply: (id: string, selected: number[]) => enqueue(() => applyNow(id, selected)),
        finish: (id: string) => enqueue(() => finishNow(id)),
        undo: (id: string) => enqueue(() => undoNow(id)),
        reject: (id: string) => enqueue(() => rejectNow(id)),
        list: () => enqueue(() => listNow()),
        get: (id: string) => enqueue(() => getNow(id)),
        recover: () => enqueue(() => recoverNow()),
        prune: () => enqueue(() => pruneNow()),
    };
}

export type ChangeSetsService = ReturnType<typeof createChangeSetsService>;

// ─── Message routing ──────────────────────────────────────────────────────────

export const CS_MESSAGE_TYPES = ['CS_SNAPSHOT', 'CS_IMPORT', 'CS_LIST', 'CS_GET', 'CS_APPLY', 'CS_FINISH', 'CS_UNDO', 'CS_REJECT'] as const;

export function isChangeSetMessage(m: unknown): m is { type: typeof CS_MESSAGE_TYPES[number] } & Record<string, unknown> {
    return !!m && typeof m === 'object' && (CS_MESSAGE_TYPES as readonly string[]).includes((m as { type?: string }).type ?? '');
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);

export async function handleChangeSetMessage(
    service: ChangeSetsService,
    msg: { type: typeof CS_MESSAGE_TYPES[number] } & Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    incognito: boolean,
): Promise<unknown> {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return { ok: false, error: `${msg.type} rejected: not an extension page` };
    if (incognito) return { ok: false, error: 'AI changes work in regular windows only.' };
    switch (msg.type) {
        case 'CS_SNAPSHOT': {
            const ids = msg.folderIds;
            if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || !ids.every(x => typeof x === 'string' && x.length <= 64)) return { ok: false, error: 'Choose at least one folder.' };
            return service.registerSnapshot(ids as string[]);
        }
        case 'CS_IMPORT': {
            if (typeof msg.text !== 'string') return { ok: false, error: 'Nothing to import.' };
            const kind = msg.sourceKind === 'file' ? 'file' : 'paste';
            const name = typeof msg.sourceName === 'string' ? msg.sourceName.slice(0, 120) : undefined;
            return service.importText(msg.text, { kind, ...(name ? { name } : {}) });
        }
        case 'CS_LIST':
            return { ok: true, sets: await service.list() };
        case 'CS_GET':
            return isId(msg.id) ? service.get(msg.id) : { ok: false, error: 'Invalid id' };
        case 'CS_APPLY': {
            const sel = msg.selected;
            if (!isId(msg.id) || !Array.isArray(sel) || !sel.every(n => typeof n === 'number')) return { ok: false, error: 'Invalid CS_APPLY message' };
            return service.apply(msg.id, sel as number[]);
        }
        case 'CS_FINISH':
            return isId(msg.id) ? service.finish(msg.id) : { ok: false, error: 'Invalid id' };
        case 'CS_UNDO':
            return isId(msg.id) ? service.undo(msg.id) : { ok: false, error: 'Invalid id' };
        case 'CS_REJECT':
            return isId(msg.id) ? service.reject(msg.id) : { ok: false, error: 'Invalid id' };
    }
}
