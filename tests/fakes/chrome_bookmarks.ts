// SPDX-License-Identifier: AGPL-3.0-only
//
// In-memory chrome.bookmarks fake: a real tree with ids, indices, permanent
// folders, folderType/syncing, managed nodes, events, and fault injection.
// Every method supports both the promise and the callback form, like Chrome.

type Node = chrome.bookmarks.BookmarkTreeNode;
type Listener = (...args: unknown[]) => void;

function makeEvent() {
    const listeners = new Set<Listener>();
    return {
        addListener: (fn: Listener) => { listeners.add(fn); },
        removeListener: (fn: Listener) => { listeners.delete(fn); },
        hasListener: (fn: Listener) => listeners.has(fn),
        _emit: (...args: unknown[]) => { for (const l of [...listeners]) l(...args); },
        _clear: () => listeners.clear(),
        _count: () => listeners.size,
    };
}

export interface FakeOptions {
    /** Add a second, account-synced set of permanent folders (Chrome's dual storage). */
    accountStorage?: boolean;
    /** Omit folderType/syncing, like Chrome before 134. */
    legacyFields?: boolean;
}

export class FakeBookmarks {
    private nodes = new Map<string, Node>();
    private nextId = 100;
    private clock = 1_700_000_000_000;
    /** Throw from the given method after it has succeeded `after` more times. */
    private faults = new Map<string, { after: number; error: string }>();

    onCreated = makeEvent();
    onRemoved = makeEvent();
    onChanged = makeEvent();
    onMoved = makeEvent();
    onChildrenReordered = makeEvent();
    onImportBegan = makeEvent();
    onImportEnded = makeEvent();

    constructor(private opts: FakeOptions = {}) { this.reset(opts); }

    reset(opts: FakeOptions = this.opts): void {
        this.opts = opts;
        this.nodes.clear();
        this.nextId = 100;
        this.faults.clear();
        this.clockSource = undefined;
        for (const e of [this.onCreated, this.onRemoved, this.onChanged, this.onMoved,
            this.onChildrenReordered, this.onImportBegan, this.onImportEnded]) e._clear();
        this.nodes.set('0', { id: '0', title: '', children: [], syncing: false } as Node);
        const perm = (id: string, title: string, folderType: string, syncing: boolean) => {
            const n: Node = { id, parentId: '0', title, children: [], dateAdded: this.clock, syncing } as Node;
            if (!opts.legacyFields) (n as { folderType?: string }).folderType = folderType;
            else delete (n as { syncing?: boolean }).syncing;
            n.unmodifiable = undefined;
            this.nodes.set(id, n);
            this.nodes.get('0')!.children!.push(n);
        };
        perm('1', 'Bookmarks bar', 'bookmarks-bar', false);
        perm('2', 'Other bookmarks', 'other', false);
        perm('3', 'Mobile bookmarks', 'mobile', false);
        if (opts.accountStorage) {
            perm('4', 'Bookmarks bar', 'bookmarks-bar', true);
            perm('5', 'Other bookmarks', 'other', true);
        }
        this.reindex('0');
    }

    /** Optional external clock for dateAdded, so it matches the code under test. */
    private clockSource?: () => number;
    useClock(source: (() => number) | undefined): void { this.clockSource = source; }

    /** Advance the fake clock used for dateAdded. */
    tick(ms = 1000): void { this.clock += ms; }
    now(): number { return this.clockSource ? this.clockSource() : this.clock; }

    failAfter(method: string, after: number, error = `Injected ${method} failure`): void {
        this.faults.set(method, { after, error });
    }

    private checkFault(method: string): void {
        const f = this.faults.get(method);
        if (!f) return;
        if (f.after <= 0) { this.faults.delete(method); throw new Error(f.error); }
        f.after--;
    }

    private reindex(parentId: string): void {
        const p = this.nodes.get(parentId);
        p?.children?.forEach((c, i) => { c.index = i; c.parentId = parentId; });
    }

    private clone(n: Node, deep: boolean): Node {
        const { children, ...rest } = n;
        const out = { ...rest } as Node;
        if (children) out.children = deep ? children.map(c => this.clone(c, true)) : undefined;
        if (!deep) delete out.children;
        return out;
    }

    private need(id: string): Node {
        const n = this.nodes.get(String(id));
        if (!n) throw new Error("Can't find bookmark for id.");
        return n;
    }

    /** Test helper: add a folder or bookmark directly (no events, no faults). */
    seed(parentId: string, title: string, url?: string, extra: Partial<Node> = {}): Node {
        const parent = this.need(parentId);
        const id = String(this.nextId++);
        const n: Node = { id, parentId, title, dateAdded: this.clock, syncing: !!parent.syncing, ...extra } as Node;
        if (url) n.url = url; else n.children = [];
        parent.children!.push(n);
        this.nodes.set(id, n);
        this.reindex(parentId);
        return n;
    }

    /** Test helper: remove a permanent folder (models account storage disappearing on sign-out). */
    dropPermanent(id: string): void {
        const n = this.need(id);
        const root = this.need('0');
        root.children!.splice(root.children!.indexOf(n), 1);
        const drop = (x: Node) => { this.nodes.delete(x.id); x.children?.forEach(drop); };
        drop(n);
        this.reindex('0');
    }

    /** Test helper: add a permanent folder with a fresh id (account storage coming back). */
    addPermanent(title: string, folderType: string, syncing: boolean): Node {
        const id = String(this.nextId++);
        const n: Node = { id, parentId: '0', title, children: [], dateAdded: this.clock, syncing } as Node;
        (n as { folderType?: string }).folderType = folderType;
        this.nodes.set(id, n);
        this.need('0').children!.push(n);
        this.reindex('0');
        return n;
    }

    /** Test helper: move a node without emitting events. */
    relocate(id: string, parentId: string): void {
        const n = this.need(id);
        const old = this.need(n.parentId!);
        old.children!.splice(old.children!.indexOf(n), 1);
        this.reindex(old.id);
        const parent = this.need(parentId);
        parent.children!.push(n);
        const setSync = (x: Node) => { x.syncing = !!parent.syncing; x.children?.forEach(setSync); };
        setSync(n);
        this.reindex(parentId);
    }

    /** Test helper: snapshot of a node's subtree as plain data. */
    tree(id = '0'): Node { return this.clone(this.need(id), true); }
    has(id: string): boolean { return this.nodes.has(String(id)); }
    titlesIn(id: string): string[] { return (this.need(id).children ?? []).map(c => c.title); }
    allBookmarks(): Node[] { return [...this.nodes.values()].filter(n => n.url).map(n => this.clone(n, false)); }

    private wrap<T>(fn: () => T, cb?: unknown): Promise<T> | undefined {
        let value: T;
        try {
            value = fn();
        } catch (err) {
            if (typeof cb === 'function') { cb(undefined); return undefined; }
            return Promise.reject(err);
        }
        if (typeof cb === 'function') { (cb as (v: T) => void)(value); return undefined; }
        return Promise.resolve(value);
    }

    // ── API surface ──────────────────────────────────────────────────────────

    api() {
        return {
            getTree: (cb?: unknown) => this.wrap(() => [this.clone(this.need('0'), true)], cb),
            getSubTree: (id: string, cb?: unknown) => this.wrap(() => [this.clone(this.need(id), true)], cb),
            get: (idOrIds: string | string[], cb?: unknown) => this.wrap(() => {
                const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
                return ids.map(i => this.clone(this.need(i), false));
            }, cb),
            getChildren: (id: string, cb?: unknown) => this.wrap(() => (this.need(id).children ?? []).map(c => this.clone(c, false)), cb),
            create: (d: chrome.bookmarks.CreateDetails, cb?: unknown) => this.wrap(() => {
                this.checkFault('create');
                const parentId = d.parentId ?? '2';
                const parent = this.need(parentId);
                if (parent.url) throw new Error("Can't add to a bookmark.");
                if (parentId === '0') throw new Error("Can't modify the root bookmark folders.");
                if (parent.unmodifiable) throw new Error("Can't modify managed bookmarks.");
                this.tick(1);
                const id = String(this.nextId++);
                const n: Node = { id, parentId, title: d.title ?? '', dateAdded: this.now(), syncing: !!parent.syncing } as Node;
                if (d.url) n.url = d.url; else n.children = [];
                const kids = parent.children!;
                const at = d.index === undefined ? kids.length : Math.max(0, Math.min(d.index, kids.length));
                kids.splice(at, 0, n);
                this.nodes.set(id, n);
                this.reindex(parentId);
                const out = this.clone(n, false);
                this.onCreated._emit(id, out);
                return out;
            }, cb),
            remove: (id: string, cb?: unknown) => this.wrap(() => {
                this.checkFault('remove');
                const n = this.need(id);
                if (!n.url && n.children?.length) throw new Error("Can't remove non-empty folder (use recursive to force).");
                this.detach(n);
            }, cb),
            removeTree: (id: string, cb?: unknown) => this.wrap(() => {
                this.checkFault('removeTree');
                this.detach(this.need(id));
            }, cb),
            search: (q: string | { url?: string; title?: string; query?: string }, cb?: unknown) => this.wrap(() => {
                const all = [...this.nodes.values()].filter(n => n.id !== '0');
                if (typeof q === 'string') {
                    const t = q.toLowerCase();
                    return all.filter(n => n.url && (n.title.toLowerCase().includes(t) || n.url.toLowerCase().includes(t))).map(n => this.clone(n, false));
                }
                if (q.url !== undefined) {
                    if (!/^[a-z][a-z0-9+.-]*:/i.test(q.url)) throw new Error('Invalid URL.');
                    return all.filter(n => n.url === q.url).map(n => this.clone(n, false));
                }
                return all.filter(n => (q.title === undefined || n.title === q.title)).map(n => this.clone(n, false));
            }, cb),
            move: (id: string, dest: { parentId?: string; index?: number }, cb?: unknown) => this.wrap(() => {
                const n = this.need(id);
                const oldParent = n.parentId!;
                const oldIndex = n.index!;
                const parent = this.need(dest.parentId ?? oldParent);
                const old = this.need(oldParent);
                old.children!.splice(old.children!.indexOf(n), 1);
                this.reindex(oldParent);
                const kids = parent.children!;
                const at = dest.index === undefined ? kids.length : Math.max(0, Math.min(dest.index, kids.length));
                kids.splice(at, 0, n);
                this.reindex(parent.id);
                this.onMoved._emit(id, { parentId: parent.id, index: n.index, oldParentId: oldParent, oldIndex });
                return this.clone(n, false);
            }, cb),
            update: (id: string, changes: { title?: string; url?: string }, cb?: unknown) => this.wrap(() => {
                const n = this.need(id);
                if (changes.title !== undefined) n.title = changes.title;
                if (changes.url !== undefined && n.url) n.url = changes.url;
                this.onChanged._emit(id, { title: n.title, url: n.url });
                return this.clone(n, false);
            }, cb),
            onCreated: this.onCreated,
            onRemoved: this.onRemoved,
            onChanged: this.onChanged,
            onMoved: this.onMoved,
            onChildrenReordered: this.onChildrenReordered,
            onImportBegan: this.onImportBegan,
            onImportEnded: this.onImportEnded,
        };
    }

    private detach(n: Node): void {
        if (n.id === '0' || n.parentId === '0') throw new Error("Can't modify the root bookmark folders.");
        if (n.unmodifiable) throw new Error("Can't modify managed bookmarks.");
        const parent = this.need(n.parentId!);
        const index = parent.children!.indexOf(n);
        parent.children!.splice(index, 1);
        this.reindex(parent.id);
        const snapshot = this.clone(n, true);
        const drop = (x: Node) => { this.nodes.delete(x.id); x.children?.forEach(drop); };
        drop(n);
        this.onRemoved._emit(n.id, { parentId: parent.id, index, node: snapshot });
    }
}

export const fakeBookmarks = new FakeBookmarks();
