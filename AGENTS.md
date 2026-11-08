# AGENTS.md

_Last updated: 2026-11-08T10:20:54+00:00 (rewritten for 1.3.0; CLAUDE.md now points here)._

The working contract for AI agents and contributors on **Bookmarks as Thumbnails**, a Chrome
Manifest V3 extension (React 19, TypeScript, Vite) that shows bookmarks as a thumbnail grid,
plus a marketing website in `website/`.

Read next, as needed: [ARCHITECTURE.md](ARCHITECTURE.md) (contexts, Trash, data flow),
[DATA_MODEL.md](DATA_MODEL.md) (every storage key), [DECISIONS.md](DECISIONS.md) (rules with
reasons), [PLAYBOOK.md](PLAYBOOK.md) (how to change, test, release, roll back),
[TESTING.md](TESTING.md), [SECURITY.md](SECURITY.md), [ROADMAP.md](ROADMAP.md) (open work),
[CHANGELOG.md](CHANGELOG.md).

## Commands

```bash
npm run dev            # Vite dev server
npm run build          # tsc -b && vite build -> dist/
npm run lint           # ESLint flat config, React Compiler rules; CI gate
npm test -- --run      # Vitest once, as CI runs it
npm run check:bundle   # worker hygiene, secret and source-map scan of dist/
npm run zip            # build + check + extension.zip for the Web Store
```

## Layout

| Path | What |
|---|---|
| `src/sw.ts` | Service worker: message router, capture, AI batches, migration, Trash upkeep |
| `src/sw/trash.ts` | Trash coordinator (single writer of `trash_*`), no import side effects |
| `src/lib/` | Shared modules; keep DOM and React out of anything the worker imports |
| `src/popup/App.tsx` | Composes hooks and renders; no logic of its own |
| `src/popup/hooks/` | All page behaviour (`useTrash`, `useBookmarkTree`, `useThumbnails`, `useToast`, ...) |
| `src/components/`, `src/popup/components/` | UI components; new styles in `src/components/shared.css` on tokens from `src/popup/index.css` |
| `src/content/capture.ts` | Content script used during capture |
| `tests/` | Vitest; `tests/fakes/chrome_bookmarks.ts`, `tests/sw_bridge.ts` |
| `scripts/check-bundle.mjs` | Post-build checks (CI) |
| `website/` | Marketing site, deployed to GitHub Pages from `main` |
| `docs/designs/` | Design documents with review history |

## Rules (do not break)

1. **Async message listeners return `true` synchronously**, never an `async` function. A
   shipped bug once; `tests/phase1_regression.test.ts` guards it and two other original
   bugs. Keep it green.
2. **Never write a "rename unknown keys" migration.** Gate migrations on
   `storage_schema_version` and check record shape (DECISIONS D1).
3. **Metadata writes merge**: `storageIndex.patch` in the worker, `patchMetadata` (sends
   `META_PATCH`) in pages. Never `storageIndex.set` a fresh record; it drops AI tags.
4. **Deletes go through Trash**: `useTrash().deleteItems` in pages. Nothing calls
   `chrome.bookmarks.remove` or `removeTree` directly except `src/sw/trash.ts`.
5. **Only the worker writes `trash_*`**, inside its queue. Pages refresh on `TRASH_CHANGED`,
   never on `chrome.storage.onChanged`.
6. **Restore never crosses storage scopes** (local vs synced) without the user choosing.
7. **The API key** is read only via `getBoundApiKey`; settings import never changes provider or
   endpoint while a key is saved; backups never contain it.
8. **No new install warnings** without the permission gate in PLAYBOOK.md.
9. **Object URLs**: `useThumbnails` revokes on replace and unmount; keep that.
10. **Stale closures**: long-lived listeners read state through refs; do not widen effect deps.
11. **React Compiler lint**: no synchronous `setState` in effect bodies (do it after an `await`
    or in a callback), no manual memoisation whose deps the compiler cannot preserve.
12. **UI**: works at 360px and on desktop, light and dark; tap targets at least 40px; real
    buttons with labels; visible focus; Undo instead of confirmation for reversible actions;
    typed confirmation for irreversible ones.
13. **Licence**: every new source file starts with `SPDX-License-Identifier: AGPL-3.0-only`.
14. **Public repo timestamps** are UTC (`date -u --iso-8601=seconds`; `TZ=UTC git commit`).
15. **The owner's test Chrome** (CDP port 9228) loads this repo's `dist/` unpacked: do not
    rebuild `dist/` casually and never take focus in that browser. QA in a separate headless
    Chrome (PLAYBOOK.md).

## Allowed without asking

Reading code, running tests, lint and builds into scratch folders, writing tests, editing source
and docs on a feature or release branch, local commits.

## Ask the owner first

Merging to `main`, pushing tags, uploading to the Chrome Web Store, changing permissions or the
licence, sending email or replying to users, deleting branches or data, anything that spends
money.

## Review

Run `/gstack-review` (or an equivalent second reviewer) on the diff before a PR; CI must pass;
the PR body lists what was verified in a real browser.
