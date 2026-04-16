# Implementation Roadmap — Bookmarks Thumbnails Extension

**Derived from:** `CODEBASE_REVIEW.md`  
**Date:** 2026-04-16  
**Total Issues Addressed:** 25 (3 Critical, 11 High, 8 Medium, 3 Low)

---

## Roadmap Overview

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
Critical   High       Arch       Perf      Testing    Hardening
Bugs       Fixes      Refactor   Optim     & CI       & Polish
(Day 1)    (Week 1)   (Week 2-3) (Week 4)  (Week 5)   (Week 6)
```

**Guiding principle:** Ship nothing broken. Fix what is actively silently failing first. Refactor only after the system is provably correct. Optimize only after the architecture is clean.

---

## Phase 1 — Critical Bug Eradication

**Duration:** 1–2 days | **Effort:** Small  
**Goal:** Eliminate the three defects that are silently breaking production functionality for all users today.

These bugs exist right now in shipped code. They must be fixed before any other work proceeds, as subsequent phases depend on the system behaving correctly.

### Objectives

- Restore SW message response delivery (currently broken for all async handlers)
- Re-enable auto-capture on folder navigation (currently a dead code path)
- Fix stale closure that would cause duplicate capture requests once auto-capture is re-enabled

### Tasks

#### Task 1.1 — Fix async message listener in SW

**File:** `src/sw.ts:24`  
**Issue Reference:** #1

The listener is declared `async`, which returns a `Promise` to Chrome instead of `true`. Chrome closes the message channel immediately.

```ts
// BEFORE
chrome.runtime.onMessage.addListener(async (message, _sender, sendResponse) => {
    // ...
    return true; // inside async fn — not a synchronous return
});

// AFTER
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CAPTURE_THUMBNAIL') {
        handleCapture()
            .then(sendResponse)
            .catch((err) => sendResponse({ error: err.message }));
        return true; // synchronous return true — holds channel open
    }
    if (message.type === 'BATCH_CAPTURE') {
        const incognito = _sender.tab?.incognito ?? false;
        processBatchCapture(message.urls, incognito, message.useActiveTabCapture);
        sendResponse({ status: 'queued' });
        return false;
    }
    if (message.type === 'SAVE_THUMBNAIL') {
        // Blobs are not transferable — remove this handler
        sendResponse({ error: 'unsupported' });
        return false;
    }
    if (message.type === 'STOP_CAPTURE') {
        stopBatchCapture = true;
        sendResponse({ status: 'stopping' });
        return false;
    }
    if (message.type === 'PING') {
        sendResponse({ status: 'ok' });
        return false;
    }
    return false;
});
```

**Verification:** Open DevTools on the SW background page. Send a `STOP_CAPTURE` message. Confirm `sendResponse` is received without "message channel closed" console errors.

---

#### Task 1.2 — Re-enable auto-capture on folder change

**File:** `src/popup/App.tsx:129–132`  
**Issue Reference:** #2  
**Depends on:** Task 1.3 must land first.

```ts
// BEFORE
if (missingUrls.length > 0) {
    // empty
}

// AFTER
if (missingUrls.length > 0) {
    handleBatchCaptureTrigger(missingUrls);
}
```

**Verification:** Navigate to a folder with uncaptured URLs. Confirm the loading indicator appears and thumbnails generate without clicking "Generate Preview."

---

#### Task 1.3 — Fix stale closure on `loadingUrls`/`queuedUrls`

**File:** `src/popup/App.tsx:123`  
**Issue Reference:** #4  
**Must land before:** Task 1.2.

```ts
// Add alongside existing thumbnailsRef
const loadingUrlsRef = useRef<Set<string>>(new Set());
const queuedUrlsRef = useRef<Set<string>>(new Set());

// Keep refs in sync
useEffect(() => { loadingUrlsRef.current = loadingUrls; }, [loadingUrls]);
useEffect(() => { queuedUrlsRef.current = queuedUrls; }, [queuedUrls]);

// Inside loadThumbsAndCapture — replace direct state reads:
if (!loadingUrlsRef.current.has(node.url) && !queuedUrlsRef.current.has(node.url)) {
    missingUrls.push(node.url);
}
```

**Verification:** Start a batch capture. While loading, navigate to the same folder again. Confirm no duplicate capture requests are sent.

---

### Phase 1 Exit Conditions

- [ ] No "message channel closed before response" console errors from SW
- [ ] Navigating to a folder with uncaptured bookmarks automatically triggers capture
- [ ] In-flight URLs are never duplicated in the capture queue on folder re-selection
- [ ] `npm run build` passes with no TypeScript errors

### Phase 1 Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| SW message refactor breaks `CAPTURE_THUMBNAIL` path | Low | Add a `PING` smoke test to confirm SW is responding |
| Auto-capture triggers on every folder navigation before thumbnails load | Medium | Task 1.3 must land before Task 1.2 — enforce via PR ordering |

---

## Phase 2 — High-Severity Reliability Fixes

**Duration:** 3–4 days | **Effort:** Medium  
**Goal:** Eliminate silent data corruption, broken API contracts, and reliability hazards.  
**Depends on:** Phase 1 complete.

### Objectives

- Remove the non-functional `SAVE_THUMBNAIL` handler
- Fix the duplicate/empty `onInstalled` listener
- Fix `StorageIndex.getAll()` namespace pollution
- Fix auto-capture saving to wrong URL on bookmark creation
- Fix `requestPermission` called without a user gesture in the SW
- Fix Stop Capture UI/SW desync
- Remove `any` type escapes in the SW

### Tasks

#### Task 2.1 — Delete empty `onInstalled` listener

**File:** `src/sw.ts:11–13`  
**Issue Reference:** #8

```ts
// DELETE this block entirely:
chrome.runtime.onInstalled.addListener(() => {

});
```

---

#### Task 2.2 — Remove `SAVE_THUMBNAIL` SW message handler

**File:** `src/sw.ts:41–53`  
**Issue Reference:** #5

`Blob` objects are not serializable over Chrome's message passing API. No caller in the current codebase sends `SAVE_THUMBNAIL` — saves happen directly in the SW after capture. Delete the entire handler block.

---

#### Task 2.3 — Fix `StorageIndex.getAll()` namespace pollution

**File:** `src/lib/storage_index.ts:18–20`  
**Issue Reference:** #3

Tactical fix (permanent fix in Task 3.8):

```ts
async getAll(): Promise<Record<string, MetadataRecord>> {
    const all = await chrome.storage.local.get(null);
    return Object.fromEntries(
        Object.entries(all).filter(
            ([k]) => !k.startsWith('thumb_') && k !== 'hasSeenWelcome'
        )
    ) as Record<string, MetadataRecord>;
}
```

---

#### Task 2.4 — Fix `handleCapture` auto-capture URL mismatch

**File:** `src/sw.ts:308–323`  
**Issue Reference:** #13

```ts
// BEFORE
if (activeTab && activeTab.url === bookmark.url) {
    try {
        await handleCapture(); // no args — re-queries active tab

// AFTER
if (activeTab && activeTab.id && activeTab.url === bookmark.url) {
    try {
        await handleCapture(activeTab.id, bookmark.url); // explicit tabId + overrideUrl
```

---

#### Task 2.5 — Fix `requestPermission` without user gesture in SW

**File:** `src/lib/fsaccess.ts:64–73`  
**Issue Reference:** #22

```ts
async restoreHandle(): Promise<boolean> {
    const record = await db.getHandle('default');
    if (!record) return false;
    this.directoryHandle = record.handle;
    // Only query — never request — from non-gesture contexts (SW)
    const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
    const state = await this.directoryHandle.queryPermission(options);
    return state === 'granted';
}
```

The `requestPermission` call must only occur in `chooseDirectory()`, triggered by a UI button click.

---

#### Task 2.6 — Fix Stop Capture UI/SW desync

**Files:** `src/sw.ts` (add broadcast) + `src/popup/App.tsx:378`  
**Issue Reference:** #21

**SW change — broadcast when batch actually stops:**
```ts
// In processBatchCapture's finally block:
} finally {
    try {
        if (captureWindow?.id) await chrome.windows.remove(captureWindow.id);
    } catch (_) { /* window already closed */ }
    isBatchCapturing = false;
    stopBatchCapture = false;
    chrome.runtime.sendMessage({ type: 'BATCH_STOPPED' }).catch(() => {});
}
```

**Popup change — listen for `BATCH_STOPPED`:**
```ts
} else if (message.type === 'BATCH_STOPPED') {
    setLoadingUrls(new Set());
    setQueuedUrls(new Set());
}
```

**Popup change — `handleStopCapture` no longer clears state immediately:**
```ts
const handleStopCapture = () => {
    // Don't clear sets here — wait for BATCH_STOPPED from SW
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
};
```

---

#### Task 2.7 — Eliminate `any` type escapes in SW

**File:** `src/sw.ts:91, 152, 167`  
**Issue Reference:** #16

```ts
// Line 91
const createOptions: chrome.windows.CreateData = {
    focused: false, state: 'normal', width: 1024, height: 768, incognito: !!incognito
};

// Line 152
const errorListener = (
    details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails
) => { ... };

// Line 167
const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => { ... };
```

---

#### Task 2.8 — Disable html2canvas debug logging

**File:** `src/content/capture.ts:23`  
**Issue Reference:** #17

```ts
logging: false,  // was: logging: true
```

---

### Phase 2 Exit Conditions

- [ ] `SAVE_THUMBNAIL` handler deleted; no references to it remain
- [ ] Empty `onInstalled` listener deleted
- [ ] `StorageIndex.getAll()` no longer returns `thumb_` or `hasSeenWelcome` records
- [ ] Auto-capture on bookmark creation stores thumbnail under `bookmark.url`
- [ ] `restoreHandle()` only calls `queryPermission`, never `requestPermission`
- [ ] Stop button: UI state clears only after `BATCH_STOPPED` from SW
- [ ] Zero `any` types in `sw.ts`
- [ ] `logging: false` in content script
- [ ] `npm run build` clean, `npm test` green

### Phase 2 Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Task 2.5 breaks FS folder restore if permission was previously prompted from SW | Medium | Test with a folder connected in a prior session — `queryPermission` should return 'granted' if already approved |
| Task 2.6 Stop desync fix delays UI feedback | Low | Add a "Stopping..." intermediate visual state |
| Task 2.3 filter list may be incomplete if new non-metadata keys are added later | Medium | Document the filter list with a comment; Phase 3 replaces this with prefix-based isolation |

---

## Phase 3 — Architectural Refactoring

**Duration:** 5–7 days | **Effort:** Large  
**Goal:** Eliminate the God Object `App.tsx`, clarify the storage layer's key scheme, and remove the ambiguous `handleCapture` API.  
**Depends on:** Phase 2 complete.

### Objectives

- Decompose `App.tsx` (869 lines) into focused custom hooks
- Establish clean storage key namespacing across both `ThumbnailStorage` and `StorageIndex`
- Replace ambiguous `handleCapture(tabIdOrWindowId?)` with two explicit functions

### Tasks

#### Task 3.1 — Extract `useSettings` hook

**New file:** `src/popup/hooks/useSettings.ts`  
**Issue Reference:** #6

Extracts: `useIncognito`, `theme`, `captureDelay`, `useActiveTabCapture`, all setters, and all `chrome.storage.sync` read/write calls.

```ts
export function useSettings() {
    const [useIncognito, setUseIncognito] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
    const [captureDelay, setCaptureDelay] = useState(500);
    const [useActiveTabCapture, setUseActiveTabCapture] = useState(false);

    useEffect(() => {
        chrome.storage.sync.get(
            ['useIncognito', 'theme', 'captureDelay', 'useActiveTabCapture'],
            (result) => {
                if (result.useIncognito !== undefined) setUseIncognito(!!result.useIncognito);
                if (result.theme) setTheme(result.theme);
                if (result.captureDelay) setCaptureDelay(Number(result.captureDelay));
                if (result.useActiveTabCapture !== undefined) setUseActiveTabCapture(!!result.useActiveTabCapture);
            }
        );
    }, []);

    const commitTheme = (t: typeof theme) => { setTheme(t); chrome.storage.sync.set({ theme: t }); };
    // ... similar pattern for each setting
    return { useIncognito, theme, captureDelay, useActiveTabCapture, commitTheme, ... };
}
```

---

#### Task 3.2 — Extract `useBookmarkTree` hook

**New file:** `src/popup/hooks/useBookmarkTree.ts`  
**Issue Reference:** #6

Extracts: `bookmarkTree`, `selectedFolderId`, `currentFolder`, folder navigation logic, `handleNavigate`, `handleNavigateBack`.

Returns: `{ bookmarkTree, selectedFolderId, currentFolder, navigate, navigateBack, refresh }`

---

#### Task 3.3 — Extract `useThumbnails` hook

**New file:** `src/popup/hooks/useThumbnails.ts`  
**Issue Reference:** #6

Extracts: `thumbnails`, `loadingUrls`, `queuedUrls`, all refs, the SW message listener effect, the folder-change load+capture effect, `handleBatchCaptureTrigger`, `handleStopCapture`, all object URL lifecycle management.

Takes `currentFolder` and `storageWarningLevel` as inputs.

---

#### Task 3.4 — Extract `useClipboard` hook

**New file:** `src/popup/hooks/useClipboard.ts`  
**Issue Reference:** #6

Extracts: `clipboard` state, `handleCut`, `handleCopy`, `handlePaste`, `copyNodeRecursively`.

---

#### Task 3.5 — Extract `useStorageWarning` hook

**New file:** `src/popup/hooks/useStorageWarning.ts`  
**Issue Reference:** #6

```ts
export function useStorageWarning(isCapturing: boolean) {
    const [storageWarning, setStorageWarning] = useState<StorageWarning>({ level: 'none', message: '' });
    // interval setup + post-capture check
    return storageWarning;
}
```

---

#### Task 3.6 — Extract `useContextMenu` hook

**New file:** `src/popup/hooks/useContextMenu.ts`  
**Issue Reference:** #6

Extracts: `contextMenu` state, `handleContextMenu`, `closeContextMenu`, `handleRename`, `handleDelete`, `handleOpen`, `handleRegenerate`, `getOpenLabel`, `menuItems` construction.

---

#### Task 3.7 — Reassemble slim `App.tsx`

After Tasks 3.1–3.6, `App.tsx` should reduce to ~100 lines:

```tsx
function App() {
    const settings = useSettings();
    const effectiveTheme = useEffectiveTheme(settings.theme);
    const { bookmarkTree, selectedFolderId, currentFolder, navigate, navigateBack } = useBookmarkTree();
    const storageWarning = useStorageWarning(/* isCapturing */);
    const { thumbnails, loadingUrls, queuedUrls, triggerCapture, stopCapture } = useThumbnails(currentFolder, storageWarning.level);
    const clipboard = useClipboard(selectedFolderId);
    const contextMenu = useContextMenu({ triggerCapture, clipboard, navigate });

    return (
        <div className={`app-container theme-${effectiveTheme}`}>
            <TopBar ... />
            {storageWarning.level !== 'none' && <StorageBanner ... />}
            <div className="content-wrapper">
                <Sidebar ... />
                <MainContent ... />
            </div>
            {contextMenu.visible && <ContextMenu ... />}
            {showWelcome && <WelcomeModal ... />}
        </div>
    );
}
```

---

#### Task 3.8 — Add `meta_` key prefix to `StorageIndex`

**File:** `src/lib/storage_index.ts`  
**Issue Reference:** #3 (permanent fix, replaces Task 2.3 tactical fix)

```ts
export class StorageIndex {
    private readonly PREFIX = 'meta_';
    private key(id: string): string { return `${this.PREFIX}${id}`; }

    async get(id: string) { ... chrome.storage.local.get(this.key(id)) ... }
    async set(record: MetadataRecord) { ... chrome.storage.local.set({ [this.key(record.id)]: record }) ... }
    async remove(id: string) { ... chrome.storage.local.remove(this.key(id)) ... }

    async getAll(): Promise<Record<string, MetadataRecord>> {
        const all = await chrome.storage.local.get(null);
        return Object.fromEntries(
            Object.entries(all)
                .filter(([k]) => k.startsWith(this.PREFIX))
                .map(([k, v]) => [k.slice(this.PREFIX.length), v])
        ) as Record<string, MetadataRecord>;
    }
}
```

**Migration on update** — add to the real `onInstalled` handler:
```ts
if (details.reason === 'update') {
    migrateStorageIndexKeys(); // reads non-prefixed non-thumb_ keys, re-writes with meta_ prefix, deletes old keys
}
```

---

#### Task 3.9 — Split `handleCapture` into two explicit functions

**File:** `src/sw.ts:325–414`  
**Issue Reference:** #7

```ts
// Capture a specific known tab (batch capture path + auto-capture)
async function captureTab(tabId: number, overrideUrl: string): Promise<CaptureOutcome>

// Capture the active tab in the current window (manual/legacy path)
async function captureActiveTab(): Promise<CaptureOutcome>

// Shared logic extracted to:
async function persistCapture(tabId: number, overrideUrl: string, dataUrl: string): Promise<void>
```

---

### Phase 3 Exit Conditions

- [ ] `App.tsx` is under 120 lines
- [ ] Each custom hook has a single, named responsibility
- [ ] `StorageIndex` uses `meta_` prefix; migration fires on extension update
- [ ] `handleCapture` replaced by `captureTab` and `captureActiveTab`
- [ ] All existing behavior preserved — no regressions on manual smoke test

### Phase 3 Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Hook extraction accidentally breaks dependency chains between state values | High | Extract one hook per PR, run smoke test after each merge |
| `meta_` migration on update silently fails for some storage shapes | Medium | Write migration as idempotent — re-running it is safe |
| `captureTab`/`captureActiveTab` split misses an edge case | Medium | Write a unit test for each path before deleting `handleCapture` |

---

## Phase 4 — Performance & Scalability Optimization

**Duration:** 3–4 days | **Effort:** Medium  
**Goal:** Make the extension responsive and memory-safe at scale (hundreds of bookmarks).  
**Depends on:** Phase 3 complete.

### Objectives

- Parallelize thumbnail loading on folder change
- Eliminate per-URL `captureDelay` storage read during batch capture
- Fix `effectiveTheme` to react to OS theme changes at runtime
- Make `BackupManager.createBackup()` memory-safe for large collections

### Tasks

#### Task 4.1 — Parallelize thumbnail loading

**File:** `src/popup/hooks/useThumbnails.ts`  
**Issue Reference:** #18

```ts
// BEFORE — sequential O(n) loop
for (const node of currentFolder.children) {
    const thumb = await thumbnailStorage.getThumbnail(node.url);
}

// AFTER — parallel fan-out
const thumbResults = await Promise.all(
    bookmarkNodes.map(async (node) => ({
        url: node.url!,
        thumb: await thumbnailStorage.getThumbnail(node.url!)
    }))
);
```

**Expected improvement:** For a 50-bookmark folder, reduces load time from `50 × latency` to `1 × max(latency)` — typically 10–30× speedup in perceived folder switch time.

---

#### Task 4.2 — Hoist `captureDelay` read out of per-URL loop

**File:** `src/sw.ts` — `processBatchCapture`  
**Issue Reference:** #17

```ts
async function processBatchCapture(urls, incognitoContext, useActiveTabCapture) {
    // Read ONCE at batch start
    const stored = await chrome.storage.sync.get(['captureDelay']);
    const captureDelay = Math.max(100, Number(stored.captureDelay || 500));

    const captureSingleUrl = async (tabId: number, url: string) => {
        // Use captureDelay directly — no storage read here
        await new Promise(resolve => setTimeout(resolve, captureDelay));
    };
}
```

**Expected improvement:** Eliminates 1 `chrome.storage.sync.get` per URL. For 100 URLs: removes 100 redundant async storage reads.

---

#### Task 4.3 — Reactive system theme detection

**File:** `src/popup/hooks/useSettings.ts`  
**Issue Reference:** #15

```ts
function useEffectiveTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
    const [systemDark, setSystemDark] = useState(
        () => window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
```

---

#### Task 4.4 — Chunk-based backup creation

**File:** `src/lib/backup_manager.ts`  
**Issue Reference:** #10, #11

Replace single `getAllThumbnails()` load with chunked key-based approach:

```ts
async createBackup(): Promise<Blob> {
    const settings = await chrome.storage.sync.get(null);
    const allStorage = await chrome.storage.local.get(null);
    const thumbKeys = Object.keys(allStorage).filter(k => k.startsWith('thumb_'));

    const CHUNK_SIZE = 25;
    const chunks: string[] = [];
    chunks.push(`{"version":1,"timestamp":${Date.now()},"settings":${JSON.stringify(settings)},"thumbnails":[`);

    let first = true;
    for (let i = 0; i < thumbKeys.length; i += CHUNK_SIZE) {
        const batch = thumbKeys.slice(i, i + CHUNK_SIZE);
        const batchData = await chrome.storage.local.get(batch);
        for (const key of batch) {
            const record = batchData[key];
            if (!record) continue;
            const entry = { id: record.id, url: record.url, image_data: record.base64 ?? '' };
            chunks.push((first ? '' : ',') + JSON.stringify(entry));
            first = false;
        }
        await new Promise(r => setTimeout(r, 0)); // yield for GC
    }
    chunks.push(']}');
    return new Blob(chunks, { type: 'application/json' });
}
```

---

### Phase 4 Exit Conditions

- [ ] Folder switch with 50 bookmarks completes thumbnail load in <500ms (DevTools Performance)
- [ ] No `chrome.storage.sync.get` calls inside `captureSingleUrl`
- [ ] Switching OS dark/light mode while extension is open reflects immediately
- [ ] Exporting backup with 200 thumbnails does not cause popup to become unresponsive

### Phase 4 Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Parallel `Promise.all` thumbnail load overwhelms `chrome.storage.local` on very large folders | Low | Cap with batches of 50 if needed |
| Chunked backup produces malformed JSON if interrupted | Low | Wrap in try/catch; delete partial blob on failure |

---

## Phase 5 — Testing Infrastructure & CI

**Duration:** 4–5 days | **Effort:** Medium–Large  
**Goal:** Establish a test baseline that prevents regressions across all future changes.  
**Depends on:** Phase 3 complete (hook decomposition makes unit testing tractable).

**Can run in parallel with Phase 4.**

### Objectives

- Configure Vitest with jsdom and a Chrome API shim
- Cover every lib class with unit tests
- Cover the Phase 1 critical bugs with regression tests
- Add CI workflow for the extension

### Tasks

#### Task 5.1 — Configure Vitest environment

**New file:** `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], globals: true },
});
```

**New file:** `tests/setup.ts`
```ts
import 'fake-indexeddb/auto';

global.chrome = {
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
        },
        sync: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        lastError: null,
    },
    bookmarks: { getTree: vi.fn(), getSubTree: vi.fn() },
} as unknown as typeof chrome;
```

---

#### Task 5.2 — Unit tests for `StorageIndex`

**New file:** `tests/storage_index.test.ts`  
**Issue Reference:** #3, #23

Required test cases:
- `set` + `get` round-trip with `meta_` prefix
- `getAll` does not return `thumb_` keys
- `getAll` does not return `hasSeenWelcome` key
- `remove` deletes only the targeted key

---

#### Task 5.3 — Unit tests for `ThumbnailStorage`

**New file:** `tests/thumbnail_storage.test.ts`  
**Issue Reference:** #23

Required test cases:
- `putThumbnail` + `getThumbnail` round-trip (Blob → base64 → Blob)
- `getThumbnail` triggers lazy migration from legacy IDB
- `deleteThumbnail` removes from both storage layers
- `getAllThumbnails` returns only `thumb_` prefixed keys

---

#### Task 5.4 — Unit tests for `BackupManager`

**New file:** `tests/backup_manager.test.ts`  
**Issue Reference:** #14, #23

Required test cases:
- `importBackup` with `version: 2` throws "Unsupported backup version"
- `importBackup` with valid v1 data restores correct thumbnail count
- `importBackup` does not overwrite existing records that already have a blob
- `createBackup` produces valid JSON with expected structure

---

#### Task 5.5 — Regression tests for Phase 1 critical bugs

**New file:** `tests/regression.test.ts`

```ts
describe('Phase 1 regressions', () => {
    it('auto-capture triggers when missing URLs are detected on folder change', () => {
        // Setup: mock currentFolder with 3 URLs, none in thumbnailStorage
        // Assert: handleBatchCaptureTrigger called with all 3 URLs
    });

    it('in-flight URLs are not re-queued on folder re-selection', () => {
        // Setup: loadingUrlsRef has URL A; currentFolder includes URL A
        // Assert: URL A is NOT in the missingUrls list
    });
});
```

---

#### Task 5.6 — Unit tests for `CaptureManager`

**New file:** `tests/capture_manager.test.ts`  
**Issue Reference:** #23

Required test cases:
- `captureVisibleTab` timeout fires after 5000ms
- `captureBackgroundTab` timeout fires after 10000ms
- `resizeAndCompress` produces a blob with width ≤ targetWidth
- `resizeOffscreen` uses `OffscreenCanvas` when available
- `resizeDOM` falls back when `OffscreenCanvas` is undefined

---

#### Task 5.7 — CI workflow for extension

**New file:** `.github/workflows/extension-ci.yml`  
**Issue Reference:** #25

```yaml
name: Extension CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --run
      - run: npm run build
      - name: Verify dist/ structure
        run: |
          test -f dist/sw.js
          test -f dist/content-script.js
          test -f dist/index.html
```

---

### Phase 5 Exit Conditions

- [ ] `npm test` runs without Chrome global errors
- [ ] `StorageIndex.getAll()` pollution bug covered by a dedicated test
- [ ] All lib classes have ≥1 unit test covering their primary interface
- [ ] CI workflow runs on every PR and blocks merge on failure
- [ ] Minimum 20 meaningful test cases (not counting the existing 3 IDB tests)

### Phase 5 Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Chrome API shim diverges from real Chrome behavior | Medium | Mark shim-dependent tests as "contract tests"; use manual E2E for real Chrome verification |
| Vitest jsdom doesn't support `OffscreenCanvas` | High | Mock `OffscreenCanvas` in setup.ts |
| Test suite becomes maintenance burden as storage keys evolve | Low | Centralize key prefixes as exported constants and reference in tests |

---

## Phase 6 — Hardening & Polish

**Duration:** 2–3 days | **Effort:** Small–Medium  
**Goal:** Close remaining medium and low severity issues.  
**Depends on:** Phase 5 complete (CI gates regressions from these changes).

### Objectives

- Add `content_security_policy` to manifest
- Add backup import version validation
- Fix `title` not populated in backup export
- Remove duplicate comment in SW
- Sanitize `captureDelay` input in TopBar
- Move inline styles to CSS

### Tasks

#### Task 6.1 — Declare `content_security_policy` in manifest

**File:** `public/manifest.json`  
**Issue Reference:** #19

```json
"content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
}
```

Verify build still passes — Vite-bundled code must not use `eval` or dynamic function constructors.

---

#### Task 6.2 — Backup import version validation

**File:** `src/lib/backup_manager.ts:66`  
**Issue Reference:** #18

```ts
const data: BackupData = JSON.parse(text);
if (typeof data.version !== 'number' || data.version !== 1) {
    throw new Error(`Unsupported or missing backup version: ${data.version ?? 'none'}`);
}
```

---

#### Task 6.3 — Fix empty `title` in backup export

**File:** `src/lib/backup_manager.ts:49`  
**Issue Reference:** #25

```ts
// Before building export data, fetch all metadata:
const allMeta = await storageIndex.getAll();

// In the thumbnail map:
return {
    id: t.id,
    url: t.url,
    filename: t.filename,
    title: allMeta[t.id]?.title ?? '',
    image_data: data,
};
```

---

#### Task 6.4 — Remove duplicate comment in SW

**File:** `src/sw.ts:16–17`  
**Issue Reference:** #22

Delete the second `// Listen for extension icon click` comment line.

---

#### Task 6.5 — Sanitize `captureDelay` input

**File:** `src/components/TopBar.tsx:290`

```ts
onBlur={(e) => {
    const raw = parseInt(e.target.value);
    const clamped = isNaN(raw) ? 500 : Math.max(100, Math.min(5000, raw));
    onCaptureDelayChange(clamped);
    onCaptureDelayCommit(clamped);
}}
```

---

#### Task 6.6 — Move inline styles to CSS

**File:** `src/components/TopBar.tsx:209, 329, 332`

```css
/* TopBar.css */
.theme-toggle-btn { margin-right: 4px; }
.menu-icon--danger { color: #d93025; }
.menu-title--danger { color: #d93025; }
```

---

### Phase 6 Exit Conditions

- [ ] `content_security_policy` present in manifest; no CSP violations on load
- [ ] Importing a v2 backup file shows a user-visible error
- [ ] Exported backup JSON contains correct title strings
- [ ] No duplicate comments in SW
- [ ] Capture delay input clamps to [100, 5000] visibly in the UI
- [ ] All CI checks green

---

## Consolidated Task Map

| Phase | Issue IDs | Files Touched | Effort |
|-------|-----------|---------------|--------|
| Phase 1 | #1, #2, #4 | `sw.ts`, `App.tsx` | S |
| Phase 2 | #3, #5, #7, #8, #13, #16, #17, #21, #22 | `sw.ts`, `storage_index.ts`, `fsaccess.ts`, `content/capture.ts` | M |
| Phase 3 | #6, #7 (split), #3 (permanent) | `App.tsx`, `sw.ts`, `storage_index.ts`, new hooks | L |
| Phase 4 | #10, #11, #15, #18 | hooks, `sw.ts`, `backup_manager.ts` | M |
| Phase 5 | #14, #23, #24, #25 | `tests/`, `vitest.config.ts`, `.github/workflows/` | M–L |
| Phase 6 | #12, #18, #19, #25, remaining lows | `manifest.json`, `backup_manager.ts`, `TopBar.tsx`, `sw.ts` | S |

---

## Quick Wins vs Long-Term Investments

### Quick Wins (< 1 hour each, ship immediately)
- **Task 1.2** — 2-line fix restoring auto-capture *(production bug)*
- **Task 2.1** — 3-line deletion of empty listener
- **Task 2.8** — 1-line `logging: false`
- **Task 4.2** — Move `captureDelay` read out of per-URL loop
- **Task 6.4** — Delete duplicate comment

### High Leverage (1–3 days, major quality step-up)
- **Task 1.1** — Fix async message listener *(unblocks all SW response handling)*
- **Tasks 2.3 + 3.8** — Storage key namespace fix
- **Task 5.7** — CI workflow *(prevents all future regressions automatically)*

### Long-Term Investments (1 week each, structural)
- **Phase 3** (Tasks 3.1–3.9) — God Object decomposition *(enables everything else to be clean)*
- **Phase 5** (Tasks 5.1–5.6) — Test coverage *(makes the system safe to evolve)*

---

## Sequencing Dependency Graph

```
Phase 1 (Critical bugs)
    └─► Phase 2 (High reliability)
            └─► Phase 3 (Architecture)
                    ├─► Phase 4 (Performance)     ← can run in parallel
                    └─► Phase 5 (Testing & CI)    ← can run in parallel
                                └─► Phase 6 (Hardening)
```

Phases 4 and 5 can be executed in parallel by two independent workstreams once Phase 3 is complete. Phase 6 gates on CI being in place (Phase 5) so regressions from hardening changes are caught automatically.
