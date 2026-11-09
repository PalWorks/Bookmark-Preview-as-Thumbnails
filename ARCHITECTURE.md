# Architecture

_Last updated: 2026-11-09T17:04:52+00:00 (1.7.0: AI changes and the coding-agent bridge)._

Bookmarks as Thumbnails is a Chrome Manifest V3 extension. Its only server is the feedback
relay in `worker/`, used when someone sends the feedback form (1.6.0). Everything else
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
 │  useSelection, useLinkMeta ◀─ META_UPDATED │     │  bookmarks.onRemoved ─▶ trash.noteRemoved │
 │  useFolderPrefs ── FOLDER_PREFS_SET ▶│           │  FOLDER_PREFS_SET ─▶ src/sw/folder_prefs  │
 │       ◀─ FOLDER_PREFS_CHANGED        │           │        (single writer of fpref_*)         │
 │  useHistoryStats (optional history)  │           │                                           │
 │ Components: TopBar, Sidebar (docked  │           │  bookmarks.onCreated ─▶ auto-capture      │
 │  or drawer), MainContent, TrashView, │           │        (skipped while a restore runs)     │
 │  FolderPicker, Modal, Toast,         │           │  alarms 'trash-purge' (daily) ─▶ expiry   │
 │  BookmarkPreview, AISettingsPage     │           │  onInstalled ─▶ schema-gated migration    │
 └──────────────┬──────────────────────┘           └──────────────┬────────────────────────────┘
                │ reads (getKeys + targeted get)                  │ writes
                └──────────────── chrome.storage.local ◀──────────┘
                     thumb_<url>  meta_<url>  trash_*  fpref_<folderId>  storage_schema_version  ai_*
                     chrome.storage.sync: settings          IndexedDB: legacy previews, folder handle

 Content script (content-script.js): page-side capture helper injected into capture tabs.

 Feedback form (page, src/lib/feedback.ts) ── POST /feedback, only on Send ──▶ worker/ relay ──▶ Resend ──▶ support@
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
  read-only error and incognito pages disable delete. Only the regular worker records
  deletes made outside the extension.

Verified on Chrome 156 (2026-11-08): `removeTree` fires one `onRemoved` for the root and
its `node` carries the full subtree; permanent folders expose `folderType` and `syncing`.

## Deletes made outside the extension (1.4.0)

`chrome.bookmarks.onRemoved` (regular worker, registered at top level so it wakes the worker)
calls `trash.noteRemoved` synchronously. It buffers the event and immediately starts looking
up the parent's location, because a later event in the same burst may remove the parent too.
Three seconds after the last event (or at 5,000 events, or 60 seconds after the first) the
buffer is written as one operation, inside the Trash queue:

- dropped: events without a node, permanent folders, managed (policy) nodes, ids the
  extension itself is removing (`deleteNow` marks them first; unmarked again if the removal
  fails) and roots of saved entries (covers a worker restart), and everything when the sync
  setting `trashExternal` is false;
- children removed before their folder (bottom-up sync) are put back inside the folder's
  saved tree;
- a root whose parent was already gone when its event arrived is not kept (the shape of an
  account tree disappearing at sign-out; not tested against a real sign-out);
- each entry gets ancestors and scope like an extension delete, and its original position,
  rebuilt by replaying the burst's removals backwards (each event's index was taken after the
  earlier removals);
- restore of an external entry reuses an identical bookmark, or a folder with the same title
  and links, already under the destination (it may have come back from another device), each
  existing node at most once.

Events buffered when the worker is shut down are lost; Chrome keeps the worker alive for 30
seconds after an event, longer than the 3-second wait.

## Folder prefs (1.4.0)

Colour and "hidden from search" per folder, in `fpref_<folderId>` (local storage: folder ids
differ per device). `src/sw/folder_prefs.ts` is the only writer, behind its own queue; pages
send `FOLDER_PREFS_SET` and reload on `FOLDER_PREFS_CHANGED` or `TRASH_CHANGED`. Trash
snapshots the prefs of every folder it keeps and re-applies them to the new ids on restore. The
daily alarm prunes prefs of folders that have been missing for at least 10 minutes, after the
Trash buffer is written. Exports carry prefs by folder title path; import applies them only to
a folder with exactly that path.

Search (`useBookmarkTree`) reads the tree in the same pass as the results, so the parent map is
never stale, and holds matches inside hidden folders apart until the user presses Show them
(per query). Smart Search leaves hidden folders out of every scope above them.

## Selection and bulk actions (1.4.0)

`useSelection` keeps ids for the current view (folder, search, filter, sort); ranges use the
display order at click time and items that leave the view are forgotten. Bulk delete is one
`TRASH_DELETE` (one Undo). Bulk move (`src/lib/bulk_move.ts`) runs in the page: it drops items
inside another selected folder, refuses Chrome's own folders, managed items and a folder into
itself, records every original position before the first move, and Undo moves them back per
folder in ascending original position. Its Undo lives as long as the toast. Bulk open reads
folders' current children when opening; more than 20 tabs asks inside the bar.

Cut and Paste (1.5.0) uses the same `moveNodes`, so it has the same refusals and Undo. Rename goes
through `src/lib/rename.ts`. Every move and rename Undo checks first that the item still carries
our change (the folder we moved it to, the name we gave it) and otherwise leaves it alone (D15).

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
- `useAITagger` reads only the open folder's `meta_<url>` records; `useLinkMeta` reads rating
  and "opened" time for the links in view and re-reads the ones named by `META_UPDATED`.
- `META_PATCH` accepts only allowlisted fields with valid values
  (`src/lib/metadata_sanitize.ts`); backup import merges inside the worker's per-URL queue so a
  newer rating is never overwritten.
- `useHistoryStats` reads `history.getVisits` for the links in view only when the optional
  `history` permission is granted and a history column or sort is on; nothing is stored.
- `BookmarkPreview` shows the screenshot, else the site icon from `/_favicon/` with the
  domain.

## Layout

Desktop (720px and wider): top bar, docked folder panel (hideable, remembered in sync
storage), content. Below 720px: compact top bar (Folders, title, theme, settings; full-width
search; one tool row), folder panel as a drawer, one-column grid, full-width toast and
bottom-aligned dialogs. Colours for new components come from tokens in
`src/popup/index.css` (`--color-*`, `--folder-*`), redefined under `.theme-dark`.

## External dependencies

React 19, lucide-react, html2canvas-pro 2.5.2 (capture; replaced html2canvas 1.4.1 in 1.6.0). One network service of our own: the
feedback relay in `worker/` (Cloudflare Worker, `https://thumbnail-bookmarks-feedback.sunmooncal.workers.dev`),
called only when the user sends the feedback form (`src/lib/feedback.ts`, D16). It emails
support@palworks.ai through Resend. Optional AI calls go only to the provider the user
configures (see PRIVACY.md).

## AI changes (1.7.0)

Design: [docs/designs/agent-bridge.md](docs/designs/agent-bridge.md); decisions D18 and D19.

```
 any AI (paste or file) ─┐                                    ┌─ chrome.bookmarks (create, move, update)
 coding agent (bridge) ──┴─▶ CS_IMPORT / propose_changes ─▶ change_sets.ts ──┼─ storageIndex.update (tags, ratings)
                              parse + validate (simulate)    pending cs_<id>  └─ trash.deleteItems(expectedSubtrees, origin ai-changes)
 Review panel ── CS_APPLY(selected) ─▶ approval record ─▶ journal csj_<id>_<n> per item ─▶ apply ─▶ Activity (Undo, Finish)
```

- **One format** (`src/lib/change_set/format.ts`) and **one validator** (`validate.ts`) for every
  source. The validator simulates the set on a working copy of the tree and refuses the whole
  set, with a reason per change, on any problem.
- **One coordinator** (`src/sw/change_sets.ts`) in the regular worker runs Apply, Finish and Undo
  one at a time. Each change is journaled before it runs and re-checked against what the user
  reviewed; a changed item is skipped, never overwritten. Trash runs last as one batch whose
  approved contents are frozen. Undo runs in reverse and maps ids that Trash restore changed.
  A fresh worker runs no job, so a set left mid-apply is classified item by item at start-up.
- **Export** (`snapshot.ts`): only folders the user ticks, never hidden ones; optional query
  stripping; the instructions tell any AI how to answer.

## Coding-agent bridge (1.7.0)

```
 agent ─stdio MCP─▶ bookmarks-thumbnails-mcp ─Unix socket─▶ native host (bridge/src/host.ts) ─native port─▶ agent_bridge.ts
                    (bridge/src/mcp.ts, cli.ts)  0600 socket in a 0700 folder      relay only, conn-tagged        pairing, grants, reads, propose
```

- The extension owns all state; the host is stateless and replaceable. Messages and errors
  are defined once in `src/lib/bridge/protocol.ts`, bundled into the package.
- `nativeMessaging` is optional, requested from the switch's click; the port keeps the worker
  alive while connected; the worker reconnects at start and from a one-minute alarm.
- Pairing: the extension shows a 6-digit code; the client sends it with the random pairing id it
  started with; the token goes back once and only its SHA-256 is stored.
- Reads see only the folders granted to that agent, minus folders hidden from search; cursors
  go stale on any change. Proposals become pending change sets labelled with the agent; the
  toolbar badge counts them.

## Diagram

`architecture.d2` / `architecture.svg` (render with `d2 architecture.d2 architecture.svg`).
