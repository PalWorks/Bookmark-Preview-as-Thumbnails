# Testing

_Last updated: 2026-11-08T09:06:39+00:00 (1.3.0: bookmarks fake, worker bridge, component tests; 256 tests)._

## Commands

```bash
npm test -- --run                        # all tests once (CI does this)
npx vitest run tests/trash_restore.test.ts
npx tsc -p tsconfig.test.json --noEmit    # type-check the tests
npm run lint                             # ESLint incl. React Compiler rules (CI gate)
npm run build && npm run check:bundle    # build, then worker hygiene + secret/source-map scan
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

`tests/sw_bridge.ts` routes page `TRASH_*` messages to a real `createTrashService()` and
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

## What tests cannot cover

Chrome-only behaviour (the real update path, permission warnings, the favicon cache, layout at
360px) is checked in a real browser; see "Browser QA" in [PLAYBOOK.md](PLAYBOOK.md). Automating
it is ROADMAP row 7.
