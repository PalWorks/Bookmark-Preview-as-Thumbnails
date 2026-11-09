# AGENTS.md

_Last updated: 2026-11-09T17:04:52+00:00 (1.7.0: AI changes, coding-agent bridge, rules 20 and 21)._

The working contract for AI agents and contributors on **Bookmarks as Thumbnails**, a Chrome
Manifest V3 extension (React 19, TypeScript, Vite) that shows bookmarks as a thumbnail grid,
plus a marketing website in `website/` and a small feedback relay in `worker/` (Cloudflare Worker).

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
npm run e2e            # real-Chrome smoke test of dist/ in a throwaway headless profile
npm run zip            # build + check + extension.zip for the Web Store (delete an old extension.zip first: zip appends)

cd worker && npx --yes node@22.18 --test test/index.test.ts && npm run typecheck   # feedback relay
cd bridge && node build.mjs && node --test test/*.test.ts                              # coding-agent helper
npx vite build --outDir <scratch>/build && node scripts/e2e/bridge.mjs <scratch>/build bridge/dist/cli.js
```

## Layout

| Path | What |
|---|---|
| `src/sw.ts` | Service worker: message router, capture, AI batches, migration, Trash upkeep |
| `src/sw/trash.ts` | Trash coordinator (single writer of `trash_*`), also records deletes made outside the extension; no import side effects |
| `src/sw/folder_prefs.ts` | Folder colour and hidden-from-search writer (single writer of `fpref_*`) |
| `src/sw/change_sets.ts` | AI change sets: import, apply, Finish, Undo, recovery, retention (single writer of `cs*` keys) |
| `src/sw/agent_bridge.ts` | Coding-agent bridge, extension side: native port, pairing, grants, reads, proposals (single writer of `bridge_*`) |
| `src/lib/change_set/` | Change-set format, validator (simulation), export snapshot; DOM-free |
| `src/lib/bridge/protocol.ts` | Bridge messages, errors and limits; shared with `bridge/` |
| `src/lib/` | Shared modules; keep DOM and React out of anything the worker imports |
| `src/popup/App.tsx` | Composes hooks and renders; no logic of its own |
| `src/popup/hooks/` | All page behaviour (`useTrash`, `useBookmarkTree`, `useThumbnails`, `useToast`, ...) |
| `src/components/`, `src/popup/components/` | UI components; new styles in `src/components/shared.css` on tokens from `src/popup/index.css` |
| `src/content/capture.ts` | Content script used during capture |
| `src/lib/feedback.ts`, `src/components/FeedbackDialog.tsx` | In-built feedback form and its client for the relay |
| `tests/` | Vitest; `tests/fakes/chrome_bookmarks.ts`, `tests/sw_bridge.ts` |
| `scripts/check-bundle.mjs` | Post-build checks (CI) |
| `scripts/e2e/smoke.mjs` | `npm run e2e`: real Chrome, headless, throwaway profile |
| `scripts/e2e/bridge.mjs` | Real Chrome + real host + real CLI end to end (pairing, grants, propose, apply) |
| `bridge/` | npm package `bookmarks-thumbnails-mcp`: native host, MCP server, CLI (Node 22, no runtime dependencies); publishing needs the owner |
| `worker/` | Feedback relay (Cloudflare Worker, Resend, Durable Object rate limits); deployed by hand, see `worker/README.md` |
| `website/` | Marketing site, deployed to GitHub Pages from `main`; its privacy page is `website/components/Legal.tsx` |
| `docs/designs/` | Design documents with review history; `agent-bridge.md` is the approved, not yet built, Agent changes plan |

## Rules (do not break)

1. **Async message listeners return `true` synchronously**, never an `async` function. A
   shipped bug once; `tests/phase1_regression.test.ts` guards it and two other original
   bugs. Keep it green.
2. **Never write a "rename unknown keys" migration.** Gate migrations on
   `storage_schema_version` and check record shape (DECISIONS D1).
3. **Metadata writes merge**: `storageIndex.patch` in the worker, `patchMetadata` (sends
   `META_PATCH`) in pages. Never `storageIndex.set` a fresh record; it drops AI tags. Every
   page-sent field passes `sanitizePagePatch` (`src/lib/metadata_sanitize.ts`); add a field
   there before a page can write it.
4. **Deletes go through Trash**: `useTrash().deleteItems` in pages. Nothing calls
   `chrome.bookmarks.remove` or `removeTree` directly except `src/sw/trash.ts`. (A direct
   removal would be recorded as "deleted outside this extension".)
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
15. **A maintainer's own browser may load this repo's `dist/` unpacked**: rebuilding `dist/`
    changes that install, so build QA copies into a scratch folder, never take focus in a
    browser someone is using, and QA in a separate headless Chrome (PLAYBOOK.md). Machine-specific
    notes live in the gitignored `LOCAL.md`.
16. **Only the worker writes `fpref_*`** (folder prefs, keyed by device-local folder id).
    Pages send `FOLDER_PREFS_SET` and refresh on `FOLDER_PREFS_CHANGED`. Exports name folders
    by title path, never by id.
17. **Optional permissions** (`history`) are requested only from a click handler, as the first
    call, and every use checks `chrome.permissions.contains` first; the feature must work
    without them.
18. **No key of ours in the extension.** Anything that needs our own key (feedback email) goes
    through our relay; the Resend key and `IP_HASH_SECRET` live as Worker secrets (D16). Scan `dist/` before every
    upload (`npm run check:bundle`).
19. **Docs-only changes go in their own pull request** (no CI run) or ride with the next code
    pull request; CI runs only on pull requests that change code.
20. **AI changes go through the coordinator.** Pages and the bridge never apply a change set
    themselves: they send `CS_*` messages or `propose_changes`; only `src/sw/change_sets.ts`
    applies, journals and undoes, and it removes bookmarks only through Trash.
21. **The native host holds no state.** Pairing, tokens, grants and decisions live in the
    extension; tokens are stored only as SHA-256 hashes and never logged or printed.

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
