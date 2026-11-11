# AGENTS.md

_Last updated: 2026-11-11T02:41:14+00:00 (rule 27: usage statistics carry no content and respect the off switch; 1.8.0)._

The working contract for AI agents and contributors on **Bookmarks as Thumbnails**, a Chrome
Manifest V3 extension (React 19, TypeScript, Vite) that shows bookmarks as a thumbnail grid,
plus a marketing website in `website/`, a small feedback and usage statistics relay in `worker/` and the online connector
for Claude and ChatGPT in `connector/` (both Cloudflare Workers).

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
cd connector && npm test && npm run typecheck                                          # online connector (Worker)
node scripts/e2e/connector.mjs <scratch>/build                                         # needs connector/.dev.vars
```

## Layout

| Path | What |
|---|---|
| `src/sw.ts` | Service worker: message router, capture, AI batches, migration, Trash upkeep |
| `src/sw/trash.ts` | Trash coordinator (single writer of `trash_*`), also records deletes made outside the extension; no import side effects |
| `src/sw/folder_prefs.ts` | Folder colour and hidden-from-search writer (single writer of `fpref_*`) |
| `src/sw/change_sets.ts` | AI change sets: import, apply, Finish, Undo, recovery, retention (single writer of `cs*` keys) |
| `src/sw/agent_bridge.ts` | One request handler for Ask AI, the online connector and coding agents: native port, pairing, the connector invite, grants, modes, reads, apply and undo (single writer of `bridge_*`) |
| `src/sw/remote_link.ts` | Online connector, browser side: the WebSocket to the Worker (single writer of `connector_link`) |
| `src/lib/bridge/tools.ts` | The tool list shared by Ask AI, the connector and the local MCP server; the single source of tool names, descriptions and schemas |
| `src/lib/bridge/connector.ts` | Connector wire contract and production address; shared with `connector/` |
| `src/lib/agent/llm.ts` | Ask AI's tool-calling loop (OpenAI-compatible, Anthropic, Gemini) |
| `src/lib/ai_provider_rules.ts` | Provider rules from the owner's ai-provider-kit: request shape, budgets, thinking, empty replies, errors, retries, retired defaults |
| `src/components/AIToolsTabs.tsx` | The AI Tools page's tab bar (Ask AI first) shared by the AI views |
| `src/lib/change_set/` | Change-set format, validator (simulation), export snapshot; DOM-free |
| `src/lib/bridge/protocol.ts` | Bridge messages, errors and limits; shared with `bridge/` |
| `src/lib/` | Shared modules; keep DOM and React out of anything the worker imports |
| `src/popup/App.tsx` | Composes hooks and renders; no logic of its own |
| `src/popup/hooks/` | All page behaviour (`useTrash`, `useBookmarkTree`, `useThumbnails`, `useToast`, ...) |
| `src/components/`, `src/popup/components/` | UI components; new styles in `src/components/shared.css` on tokens from `src/popup/index.css` |
| `src/content/capture.ts` | Content script used during capture |
| `src/lib/feedback.ts`, `src/components/FeedbackDialog.tsx` | In-built feedback form and its client for the relay |
| `src/lib/analytics.ts` | Usage statistics (D27): `track()`, value checks, the off switch, batching to the relay's `/events` |
| `tests/` | Vitest; `tests/fakes/chrome_bookmarks.ts`, `tests/sw_bridge.ts` |
| `scripts/check-bundle.mjs` | Post-build checks (CI) |
| `scripts/e2e/smoke.mjs` | `npm run e2e`: real Chrome, headless, throwaway profile |
| `scripts/e2e/bridge.mjs` | Real Chrome + real host + real CLI end to end (pairing, grants, propose, apply, undo) |
| `scripts/e2e/connector.mjs` | Real Chrome + the Worker under `wrangler dev` + an MCP client (registration, code sign-in, PKCE, tools, undo, revocation, offline) |
| `bridge/` | npm package `bookmarks-thumbnails-mcp`: native host, MCP server, CLI (Node 22, no runtime dependencies); publishing needs the owner |
| `worker/` | Feedback relay (Cloudflare Worker, Resend, Durable Object rate limits) and the usage statistics relay (`/events` to GA4 and PostHog); deployed by hand, see `worker/README.md` |
| `connector/` | Online connector for Claude and ChatGPT (Cloudflare Worker: MCP, OAuth 2.1, one Durable Object per link); deployed by the owner, see `connector/README.md` |
| `website/` | Marketing site, deployed to GitHub Pages from `main`; its privacy page is `website/components/Legal.tsx` |
| `docs/designs/` | Design documents with review history; `agent-bridge.md` (change sets and the local bridge, built) and `ai-assistant.md` (Ask AI and the online connector, D20) |

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
    through our relay; the Resend key, `IP_HASH_SECRET`, `GA4_API_SECRET` and `POSTHOG_KEY` live
    as Worker secrets (D16, D27). Scan `dist/` before every
    upload (`npm run check:bundle`).
19. **Docs-only changes go in their own pull request** (no CI run) or ride with the next code
    pull request; CI runs only on pull requests that change code.
20. **AI changes go through the coordinator.** Pages and the bridge never apply a change set
    themselves: they send `CS_*` messages, or the bridge calls `importText` / `importAndApply`;
    only `src/sw/change_sets.ts` applies, journals and undoes, and it removes bookmarks only
    through Trash.
21. **The native host holds no state.** Pairing, tokens, grants and decisions live in the
    extension; tokens are stored only as SHA-256 hashes and never logged or printed.
22. **One tool list.** Every AI surface (Ask AI, the connector, the local MCP server) takes its
    tools from `src/lib/bridge/tools.ts` and runs them through `agent_bridge.ts`'s request
    handler. Never copy a tool definition into `connector/`, `bridge/` or a page.
23. **The connector Worker stores nothing it reads** (D20): no bookmark data, no request or
    response bodies in logs, no tokens beyond the 2-minute authorization codes. Deploying it,
    setting or rotating `CLIENT_ID_SECRET`, and changing `CONNECTOR_ORIGIN` need the owner.
24. **Provider rules live in one module.** Request shape per provider, reply budgets, Gemini
    thinking, empty-reply detection, out-of-credit errors, retries and retired default models are
    in `src/lib/ai_provider_rules.ts`, used by Auto-Tag, Smart Search and Ask AI (D21). Gate
    model behaviour on named sets keyed `provider:model`, never on a pattern over the id.
25. **The Cloudflare account is shared** with the owner's other projects (13 Workers, among them
    Reply Wizard's live API). Change only `bookmarks-thumbnails-connector` and
    `thumbnail-bookmarks-feedback`: never the account's workers.dev name, another Worker, its
    routes or custom domains, or DNS records you did not create (D22).
26. **AI output is data, never markup** (D24): render model text as plain text; links from AI rows
    only when http(s), in a new tab with `noopener`; no AI change sets a URL or opens a page; in
    Ask AI nothing goes to Trash without the user's click (`sendsToTrash`). The worker answers only
    the extension's own pages (`src/lib/sender.ts`).
27. **Usage statistics carry no content** (D27): events go only through `track()` in
    `src/lib/analytics.ts`; a value is a number, a boolean or a short word
    (`/^[A-Za-z0-9_.:-]{0,40}$/`), never a link, title, folder name, search, chat text, key or
    exact library size (use `bucket()`). `track()` sends nothing when **Share usage statistics** is
    off (`usage_stats` false in sync) or in incognito. Adding an event: name it in snake_case, add
    it to the event list in PRIVACY.md and DECISIONS D27 in the same pull request. The relay
    (`worker/src/events.ts`) checks every value again; keep both checks in step.

## Allowed without asking

Reading code, running tests, lint and builds into scratch folders, writing tests, editing source
and docs on a feature or release branch, local commits. Merging a PR to `main` once it has been
reviewed and CI passes, then rebuilding `dist/` from `main` (owner, 2026-11-10: report afterwards).

## Ask the owner first

Pushing tags, publishing to npm, uploading to the Chrome Web Store, deploying a Worker
(`worker/` or `connector/`) or setting its secrets (the owner approved a deploy of both on
2026-11-10; each later deploy still asks), changing permissions or the licence, sending email or replying to users, deleting branches or data, anything that spends
money.

## Review

Run `/gstack-review` (or an equivalent second reviewer) on the diff before a PR; CI must pass;
the PR body lists what was verified in a real browser.
