# Testing

_Last updated: 2026-11-11T02:41:14+00:00 (481 Vitest tests and 34 relay tests: usage statistics, D27)._

## Commands

```bash
npm test -- --run                        # all tests once (CI does this)
npx vitest run tests/trash_restore.test.ts
npx tsc -p tsconfig.test.json --noEmit    # type-check the tests
npm run lint                             # ESLint incl. React Compiler rules (CI gate)
npm run build && npm run check:bundle    # build, then worker hygiene + secret/source-map scan
npm run e2e                              # real Chrome, headless, throwaway profile (needs a build)
cd worker && npx --yes node@22.18 --test test/index.test.ts && npm run typecheck   # feedback and usage statistics relay, 34 tests
cd bridge && node build.mjs && node --test test/*.test.ts                            # coding-agent helper, 9 tests
node scripts/e2e/bridge.mjs <build> bridge/dist/cli.js                               # real Chrome + host + CLI, 18 checks
cd connector && npm test && npm run typecheck                                        # online connector Worker, 36 tests
cd connector && npm run smoke                                                        # Worker alone under wrangler dev
node scripts/e2e/connector.mjs <build>                                               # real Chrome + Worker + MCP client, 15 checks
```

`<build>` is a scratch build (`npx vite build --outDir <scratch>/build`), never `dist/` on a
feature branch. `scripts/e2e/connector.mjs` needs `connector/.dev.vars` with a
`CLIENT_ID_SECRET` (CI writes a random one); it starts `wrangler dev --local` itself. Because
`connector/wrangler.toml` names a custom domain, `wrangler dev` would otherwise give requests that
domain's host, so the e2e script and `connector/scripts/smoke.mjs` pass `--local-upstream
127.0.0.1:<port>`; without it the authorize page answers "This link does not match".

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
| Feedback client: validation, payload, counts-only details, Edge detection, rate-limit, relay, network and timeout errors | `feedback.test.ts` |
| 1.6.0 settings menu (Generate Preview sub-menu, backup icon row, trash-icon Delete), the single AI Tools item, the AI Tools tab order and the icon-only Ask AI button, and the feedback dialog (no details when unticked, double submit sends once, text kept after a failed send) | `components/Menu.test.tsx` |
| Capture page copy without scripts, expected failures logged as warnings | `content_capture.test.ts` |
| Feedback relay: origins, limits, Durable Object counters, IPv6 /64, body caps, sanitising, provider errors; `/events`: origin check, batch cleaning, GA4 and PostHog bodies | `worker/test/index.test.ts` (Node test runner, not in the Vitest count) |
| Usage statistics: value checks (`safeParams`), count buckets, message-to-event mapping, the off switch, incognito, batching and the dev flag (the real module; every other suite mocks `track` and `flush` in `tests/setup.ts`) | `analytics.test.ts` |
| AI change sets: format parsing, every validation rule, simulation, apply as one step and Undo (tree, tags, ratings, Trash), skipped changes, frozen Trash, move out then trash parent, dependency unticking, interrupted apply and Finish, expiry, retention, scope, storage-key shape | `change_sets.test.ts` |
| AI changes in the App: import, review, untick, apply, Undo, refused sets, export of ticked folders only with query stripping | `components/AIChanges.test.tsx` |
| Coding-agent bridge, extension side: error contract, pairing (code never sent, id-bound, 3 tries, 2 min, 5 an hour), grants and hidden folders for every tool, cursors, read-only, idempotency, per-agent caps, ownership, version handshake | `agent_bridge.test.ts` |
| D20 bridge: `apply_changes` applies at once and `undo_changes` reverts it, retries never apply twice, one bad change refuses the whole call, review mode only proposes, read mode refuses, a connection cannot undo another's set, Ask AI scope (every non-hidden folder, never paired), the connector's standing code with its folders and mode, five wrong codes end it | `agent_bridge.test.ts` |
| Ask AI: shared tool list mapping, the three provider adapters (OpenAI-compatible, Anthropic, Gemini), key in a header never the URL, providers without tool calling refused, the tool loop and its cap, tool errors, change cards with Undo | `ask_ai.test.ts` |
| Provider rules (ai-provider-kit, D21): OpenAI `max_completion_tokens` and no temperature, the 300-token floor and thinking headroom by named set, Gemini thinking switch, empty replies cut at the limit in all three shapes, out of credit before rate limits, xAI 400 and 403, retries (5xx yes; 401, out-of-credit 429 and our own abort no; `Retry-After` clamped), retired defaults upgraded only on an exact match, OpenRouter checked at `/key` with management keys refused | `ai_provider_rules.test.ts` |
| Ask AI chats and safety (D24): save, list, load, delete, the 50 cap, malformed rows; model list filtering and the key in a header; the per-provider Ask AI model; the system prompt names the model and strips odd characters; preview rows keep only http(s) links; changed before looked-at | `ask_ai_chats.test.ts` |
| Security checks: plain http only on the local network, only the extension's own pages may message the worker, Trash detection; a token works only on its own transport; remote connections strip query strings by default; Ask AI Trash waits as pending; Redo once | `ai_provider_rules.test.ts`, `agent_bridge.test.ts` |
| Ask AI in the App: what to set up without a provider; the side panel; a change applied at once with Undo and Redo from the header; bubbles, times and the day divider; chats reopened; the AI Tools page with previews; Trash waits for Apply, Don't changes nothing | `components/AskAI.test.tsx` |
| Online connector, browser side: off until switched on, hello with id and secret, relay by request id, pings, reconnect, a new address, only a local development origin may override | `remote_link.test.ts` |
| Connect Claude or ChatGPT page: switch, address with Copy, standing code with folders and mode, connected apps | `components/Connect.test.tsx` |
| Connector Worker: link hello and secret hash, relay and offline, one-time codes and their 2-minute life, limits per link and per network, signed client ids and page state, redirect URI rules, PKCE, metadata, MCP JSON-RPC edges, the full OAuth flow, fail closed without `CLIENT_ID_SECRET` | `connector/test/*.test.ts` (Node test runner, not in the Vitest count) |
| Package version and docs/bridge.md stay in step with the protocol | `bridge_version.test.ts` |
| Native host as a real process (framing, per-connection relay, limits, socket and folder modes, link refusal), install/uninstall/doctor on a fake home, CLI exit codes, MCP server end to end | `bridge/test/*.test.ts` (Node test runner) |
| Whole app 1.4.0 flows: range select and bulk delete, bulk move and Undo, Ctrl+A, colour, hidden from search, rating, Trash switch | `components/Bulk.test.tsx` |

## What tests cannot cover

Chrome-only behaviour (the real update path, permission warnings, the favicon cache, layout at
360px) is checked in a real browser; see "Browser QA" in [PLAYBOOK.md](PLAYBOOK.md).
`scripts/e2e/bridge.mjs` loads a temporary copy of the build with `nativeMessaging` required
(headless Chrome cannot click Allow) and drives the real host and CLI through pairing, grants,
propose, apply and undo. `scripts/e2e/connector.mjs` runs real Chrome with the extension, the
real Worker under `wrangler dev --local`, and an MCP client that registers, signs in with the
code the extension shows, exchanges it with PKCE, reads only the ticked folder, applies and
undoes a change, and checks revocation (401 after removal) and the offline answer. Real Claude
and ChatGPT clients against the deployed Worker are not covered by any test; they passed a
manual run on 2026-11-10.
`npm run e2e` (`scripts/e2e/smoke.mjs`) automates the core of it locally: it starts its own
headless Chrome with a throwaway profile, loads `dist/`, and checks that a delete made outside the
extension is kept and restores with its colour, that an extension delete is recorded once, the
360 px and 1280 px layouts, and the console. CI runs it, then the bridge and connector e2e
scripts, at the end of its single job, after the connector tests and typecheck
(Node 22 for the built-in WebSocket; `E2E_NO_SANDBOX=1` adds `--no-sandbox`, which the runner
needs). CI runs only on pull requests that change code; docs-only pull requests skip it, so run
the full local set before every push. A full run of the
suite under heavy machine load has once timed out an App test (one in eleven runs on
2026-11-08); a re-run passes.
