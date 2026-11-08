# Architecture

_Last updated: 2026-11-08T09:06:39+00:00 (1.3.0: Trash coordinator, reactive bookmark tree, favicon previews, responsive layout)._

Bookmarks as Thumbnails is a Chrome Manifest V3 extension. It has no server. Everything
runs in three browser contexts and stores data in `chrome.storage`. Storage keys and
record shapes are in [DATA_MODEL.md](DATA_MODEL.md); the reasons behind the main choices
are in [DECISIONS.md](DECISIONS.md).

## Contexts and boundaries

```
 Extension page (index.html, React)                Service worker (sw.js)
 ┌─────────────────────────────────────┐ messages  ┌───────────────────────────────────────────┐
 │ App.tsx: composes hooks, no logic    │──────────▶│ router (sw.ts, listeners return true)     │
 │  useBookmarkTree ◀─ bookmarks.on*    │           │  ├─ BATCH_CAPTURE / STOP_CAPTURE          │
 │  useThumbnails   ◀─ THUMBNAIL_*      │◀──────────│  │    hidden window, 5-tab worker pool    │
 │  useTrash  ── TRASH_* ──────────────▶│ broadcasts│  ├─ META_PATCH ─▶ storageIndex.patch      │
 │            ◀─ TRASH_CHANGED          │           │  ├─ AUTO_TAG / AI_SEARCH / CHECK_AI_*     │
 │  useAITagger ◀─ TAG_*                │           │  └─ TRASH_* ─▶ src/sw/trash.ts            │
 │  useToast, useSettings, useClipboard │           │        one promise queue (single writer)  │
 │  useContextMenu, useMediaQuery       │           │        reconcile() before every mutation  │
 │ Components: TopBar, Sidebar (docked  │           │  bookmarks.onCreated ─▶ auto-capture      │
 │  or drawer), MainContent, TrashView, │           │        (skipped while a restore runs)     │
 │  FolderPicker, Modal, Toast,         │           │  alarms 'trash-purge' (daily) ─▶ expiry   │
 │  BookmarkPreview, AISettingsPage     │           │  onInstalled ─▶ schema-gated migration    │
 └──────────────┬──────────────────────┘           └──────────────┬────────────────────────────┘
                │ reads (getKeys + targeted get)                  │ writes
                └──────────────── chrome.storage.local ◀──────────┘
                     thumb_<url>  meta_<url>  trash_*  storage_schema_version  ai_*
                     chrome.storage.sync: settings          IndexedDB: legacy previews, folder handle

 Content script (content-script.js): page-side capture helper injected into capture tabs.
```

- **Service worker** (`src/sw.ts`): message router, capture orchestration, AI batch
  tagging, update migration, Trash upkeep. Listeners that answer asynchronously return
  `true` synchronously (a shipped bug once; do not reintroduce). Trash logic lives in
  `src/sw/trash.ts`, which has no import side effects so tests can build fresh instances.
- **Extension page** (`src/popup/`): React 19. `App.tsx` only composes hooks and renders
  components; behaviour lives in `src/popup/hooks/`.
- **Shared libraries** (`src/lib/`): imported by both sides, so they stay free of DOM and
  React where the worker uses them (`trash_store`, `bookmark_tree`, `storage_index`,
  `utils`, `ai_settings_storage`). CI enforces this with `scripts/check-bundle.mjs`.

## Trash (1.3.0)

The worker is the only writer of `trash_*` keys. Every mutation (`TRASH_DELETE`,
`TRASH_RESTORE`, `TRASH_EMPTY`, `TRASH_PURGE`) runs through one in-memory promise queue,
so two tabs pressing Undo at once produce one copy. Pages read Trash directly and refresh
on the `TRASH_CHANGED` broadcast, never on raw `storage.onChanged` (that would also deliver
every preview image a capture writes).

```
           TRASH_DELETE: snapshot written        bookmark removed
 (none) ───────────────────────────▶ prepared ───────────────────▶ deleted ◀────────┐
                                       │ removal failed                │ restore      │
                                       ▼                               ▼              │
                                 (entry dropped)                   restoring          │
                                                                    │       │         │
                                                              done  │       │ error   │
                                                                    ▼       ▼         │
                                                             restored     failed ─────┘
                                                            (10 min)   (Retry resumes)
```

- **Delete.** Validate every id (missing ids are skipped; a permanent or managed node
  rejects the whole request so one action is always one Undo). Drop ids nested in another
  selected folder. Snapshot each root (subtree, index, ancestors, storage scope) and write
  all snapshots in one `storage.local.set` before the first removal. Just before removing a
  folder, re-read it and update the snapshot if something was moved in meanwhile. Remove
  each root; failures drop only that root's entry.
- **Restore.** Put roots back in ascending original index. Parent lookup: the deepest
  surviving ancestor in the same storage scope (recreating missing folders below it by
  title, reusing a same-titled folder), else a permanent folder with the same
  `folderType` and `syncing`, else fail closed and ask the user with the **Restore to...**
  picker. A title never chooses a scope, so a local bookmark is never moved into synced
  account storage automatically.
- **Crash recovery.** `reconcile()` runs on worker start and before each queued mutation:
  `prepared` with the bookmark still present is dropped (the delete never happened),
  otherwise promoted to `deleted`; a `restoring` entry is stale and becomes `failed`.
  A retried restore reuses nodes the interrupted attempt created (same parent, title and
  URL, created between that attempt's start and its failure record), so Retry never
  duplicates, even when the worker died before any checkpoint. A partial copy moves with the
  user to a new Restore to... destination. A folder restored after one of its children
  merges into the copy that child's restore recreated (never into a folder the user made).
  Progress is a small separate record, checkpointed every 25 creates, so large restores do
  not rewrite the snapshot.
- **Auto-capture guard.** While a restore creates bookmarks, `onCreated` auto-capture is
  skipped for 60 seconds after the last create (the incognito worker reads the same
  deadline from storage).
- **Expiry and Empty.** Entries expire after 30 days (daily alarm, and whenever Trash
  opens); restored entries linger 10 minutes so a repeated Undo is a no-op. Empty and
  expiry run an asset sweep journaled in `trash_purge_pending`: a URL's `thumb_`, `meta_`
  and legacy IndexedDB preview are removed only when no live bookmark and no remaining
  entry uses it. A capture that finishes after its bookmark was deleted writes nothing (the
  worker checks the bookmark still exists right before writing).
- **Incognito.** With `incognito: "split"`, the incognito worker answers `TRASH_*` with a
  read-only error and incognito pages disable delete. Trash covers deletions made in this
  extension only; deletions in Chrome's own manager are not captured (see ROADMAP).

Verified on Chrome 156 (2026-11-08): `removeTree` fires one `onRemoved` for the root and
its `node` carries the full subtree; permanent folders expose `folderType` and `syncing`.

## Capture flow

`BATCH_CAPTURE` → hidden window → tab pool navigates, waits for load and a render delay →
`captureManager.capture()` → resize and compress to WebP → `thumb_<url>` (and the
connected folder, if any) → `storageIndex.patch()` → `THUMBNAIL_UPDATED` broadcast. Failed
navigations get a generated error image. The storage id is always the original bookmark
URL, even after redirects.

## Page data flow

- `useBookmarkTree` subscribes to all bookmark events and coalesces bursts into one
  refresh per 150 ms (paused during a bookmark import). If the open folder disappears it
  moves to the nearest surviving ancestor.
- `useThumbnails` keeps loaded previews in memory and reads only missing ones on refresh;
  object URLs are revoked on replace and unmount.
- `useAITagger` reads only the open folder's `meta_<url>` records.
- `BookmarkPreview` shows the screenshot, else the site icon from `/_favicon/` with the
  domain.

## Layout

Desktop (720px and wider): top bar, docked folder panel (hideable, remembered in sync
storage), content. Below 720px: compact top bar (Folders, title, theme, settings; full-width
search; one tool row), folder panel as a drawer, one-column grid, full-width toast and
bottom-aligned dialogs. Colours for new components come from tokens in
`src/popup/index.css` (`--color-*`, `--folder-*`), redefined under `.theme-dark`.

## External dependencies

React 19, lucide-react, html2canvas (content script). No network services of our own.
Optional AI calls go only to the provider the user configures (see PRIVACY.md).

## Diagram

`architecture.d2` / `architecture.svg` (render with `d2 architecture.d2 architecture.svg`).
