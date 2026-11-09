# Testing

_Last updated: 2026-11-09T05:23:51+00:00 (1.6.0: feedback tests, 367 tests; CI cut to one job on code pull requests)._

## Commands

```bash
npm test -- --run                        # all tests once (CI does this)
npx vitest run tests/trash_restore.test.ts
npx tsc -p tsconfig.test.json --noEmit    # type-check the tests
npm run lint                             # ESLint incl. React Compiler rules (CI gate)
npm run build && npm run check:bundle    # build, then worker hygiene + secret/source-map scan
npm run e2e                              # real Chrome, headless, throwaway profile (needs a build)
```

## Setup

Vitest with jsdom and the React plugin (`vitest.config.ts`); files `tests/**/*.test.ts` and
`tests/**/*.test.tsx`. `tests/setup.ts` provides a Chrome mock that is re-wired before every test:

- `chrome.storage.local` / `sync` backed by `localStore` / `syncStore` (with `getKeys`).
- `chrome.bookmarks` from `tests/fakes/chrome_bookmarks.ts`: a real in-memory tree with
  permanent folders, `folderType` and `syncing`, managed nodes, events (`onCreated`, `onRemoved`
  with the removed subtree, `onImport*`), both promise and callback forms, and fault injection
  (`failAfter('create', n)`). Options model account storage (`accountStorage`) and older Chrome
  (`legacyFields`).
- `chrome.alarms` fake, `chrome.runtime.getURL`, `chrome.extension.inIncognitoContext`.
- `fake-indexeddb` for the legacy preview store.

`tests/sw_bridge.ts` routes page `TRASH_*` and `FOLDER_PREFS_SET` messages to a real
`createTrashService()` and `createFolderPrefsService()` and
delivers its broadcasts to `runtime.onMessage` listeners, so hook and App tests run the page and
the worker together. `tests/trash_helpers.ts` builds "fresh worker" instances over the same
storage and bookmarks to test crash recovery.

## What is covered

| Area | Files |
|---|---|
| Update migration and key repair (1.2.1 regression) | `storage_migration.test.ts` |
| Tag-preserving metadata writes | `storage_index.test.ts`, `metadata_client.test.ts`, `backup_manager.test.ts` |
| API key binding | `ai_settings_storage.test.ts`, `ai_tagger.test.ts` |
| Trash delete: snapshot, protected and managed, partial failure, retries | `trash_delete.test.ts` |
| Trash restore: order, nesting, missing parents, storage scope, crash resume, write volume | `trash_restore.test.ts` |
| Reconcile, Empty, expiry, asset sweep incl. IndexedDB | `trash_purge.test.ts` |
| Settings allowlist, settings-only export, tampered import | `backup_manager.test.ts` |
| Reactive tree, coalescing, import pause, deleted folder fallback | `hooks/useBookmarkTree.test.ts` |
| Trash client: toasts, Undo, retry on a sleeping worker, incognito | `hooks/useTrash.test.ts` |
| Toast timing, Ctrl/Cmd+Z, pause on hover | `components/Toast.test.tsx` |
| Trash view states and the picker | `components/TrashView.test.tsx` |
| Whole app: tile delete and Undo, Delete key, context menu, Trash, Empty, phone drawer | `components/App.test.tsx` |
| Deep counts, favicon URL, labels | `utils.test.ts` |
| Deletes made outside the extension: recording, own deletes, child-first bursts, sign-out and policy shapes, order, dedupe, prefs | `trash_external.test.ts` |
| Folder prefs writer, concurrency, prune grace, message checks | `folder_prefs.test.ts` |
| Metadata allowlist and the import merge | `metadata_sanitize.test.ts`, `backup_manager.test.ts` |
| Bulk move and its Undo (skips items moved again) | `bulk_move.test.ts` |
| Rename and its Undo (never overwrites a newer name) | `rename.test.ts` |
| Whole app 1.5.0 flows: rename Undo (button, Ctrl+Z, newer name), Cut and Paste Undo, a folder into itself | `components/Edits.test.tsx` |
| Selection, history permission, link metadata refresh | `hooks/useSelection.test.ts`, `hooks/useHistoryStats.test.tsx`, `hooks/useLinkMeta.test.ts` |
| List column values and sorting | `list_columns.test.ts` |
| Whole app 1.4.0 flows: range select and bulk delete, bulk move and Undo, Ctrl+A, colour, hidden from search, rating, Trash switch | `components/Bulk.test.tsx` |

## What tests cannot cover

Chrome-only behaviour (the real update path, permission warnings, the favicon cache, layout at
360px) is checked in a real browser; see "Browser QA" in [PLAYBOOK.md](PLAYBOOK.md).
`npm run e2e` (`scripts/e2e/smoke.mjs`) automates the core of it locally: it starts its own
headless Chrome with a throwaway profile, loads `dist/`, and checks that a delete made outside the
extension is kept and restores with its colour, that an extension delete is recorded once, the
360 px and 1280 px layouts, and the console. CI runs it as the last step of its single job
(Node 22 for the built-in WebSocket; `E2E_NO_SANDBOX=1` adds `--no-sandbox`, which the runner
needs). CI runs only on pull requests that change code; docs-only pull requests skip it, so run
the full local set before every push. A full run of the
suite under heavy machine load has once timed out an App test (one in eleven runs on
2026-11-08); a re-run passes.
