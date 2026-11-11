# Decisions

_Last updated: 2026-11-11T06:01:16+00:00 (D27 wording: development copies are marked as test traffic)._

Architecture decision records: why things are the way they are. Newest first. Each ends with
the rule it imposes. Detailed reasoning is in
[docs/designs/release-1.3.0-safe-delete-and-parity.md](docs/designs/release-1.3.0-safe-delete-and-parity.md) and
[docs/designs/release-1.4.0-organise-and-recover.md](docs/designs/release-1.4.0-organise-and-recover.md).

## D27. Usage statistics, on by default (owner, 2026-11-11)

The owner wants to see how people use the extension, through Google Analytics and PostHog,
on until the user turns them off. I recommended asking first (EU and UK rules expect consent
before storing an id on the device for statistics); the owner chose on by default with an off
switch, and the privacy texts say so plainly.

- **Path:** the extension posts small batches to our relay (`/events` on the feedback
  Worker); the relay holds the GA4 Measurement Protocol secret and the PostHog key and
  forwards. The extension holds no analytics key and needs no new permission.
- **Content:** a random install id, a session number, the version, event names, and values
  that are numbers, booleans or short words without spaces or slashes. The extension and the
  relay both drop anything else, so no link, title, folder name, search or chat text can
  pass. Counts go as ranges. The relay sends the country, never the IP address. PostHog gets
  no person profiles.
- **Off switch:** Settings > Share Usage Statistics (synced). Off means nothing is sent;
  Incognito windows never send. Development copies are marked as test traffic: GA4 `debug_mode`
  (shown in DebugView; kept out of reports only while the property's Developer traffic filter
  is active) and `dev` in PostHog (filter it out in insights).
- **Events:** feature messages the service worker already receives (previews, Auto-Tag, Smart
  Search, connector and coding agents on or off, AI change undo, redo, approve and discard,
  Trash, Ask AI tool calls) plus page events (opened, panel, view mode, search started, Ask AI
  sent, backup, feedback) and install or update.

**Rule:** a usage event carries no user content; new events use the same safe value types.

## D26. Ask AI knows the open folder (owner, 2026-11-11)

In the side panel, "how many bookmarks are in this folder?" got "which folder?". The panel now
sends the open folder with each message: its path from the root, its id and how many items it
holds directly. A chip above the message box shows the folder and turns it off for that folder;
each sent message shows the folder it went with. The line is marked as context, not an
instruction; the folder names in it are quoted, cut to 200 characters and stripped of line
breaks, because names can come from imports and sync. Nothing is sent during a search or on the
full AI Tools page, where no folder is open. Day dividers stay at the top of the chat while it
scrolls and read Today, Yesterday, the weekday within a week, then the date.

**Rule:** the app adds context to a message only as quoted data the user can see and turn off.

## D25. The helper asks before allowing an unpacked copy (owner, 2026-11-11)

Security review F7: install trusted every unpacked extension whose manifest carried our name.
The owner chose to keep detection automatic but to ask once. Install now lists each copy it
finds (id, folder, Chrome data folder) and allows it only after a yes in a terminal; the answer
is kept in `trusted-extensions.json` in the helper's folder (mode 600) and asked again if the copy
moves. Without a terminal (the MCP server's first run, scripts) nothing is allowed and the output
says how: run install in a terminal, or pass `--extension-id`. A copy in a folder another user
owns or can change is never allowed. Other ways to trust a copy were weighed:

- **The Web Store id** is the only proof: Google signs that package and no one else can use its
  id. It stays trusted without asking.
- **A fixed `key` in a development manifest** gives a stable id, but the key is public, so anyone
  can copy it and get the same id. Rejected as proof.
- **A hash of the build** changes with every development build, and a copy of our code has the
  same hash. Rejected.
- **A secret shared between helper and extension** would sit in readable files of the unpacked
  folder. Rejected.

**Rule:** only the Web Store copy is trusted by default; any other copy needs the user's yes.

## D24. Ask AI beside the bookmarks; Trash needs the user's OK (owner, 2026-11-10)

The owner reviewed Ask AI in the test browser and asked for:

- **A side panel**, like an assistant docked in the browser: the top bar's icon opens Ask AI next
  to the folders and tiles, so the user sees the real bookmarks change. The AI Tools page keeps
  the full view, with previews of what changed.
- **Chats like ChatGPT and Claude**: bubbles on both sides, a time on every message, past chats to
  go back to, and a model picker that lists the models the key can reach.
- **Apply by default, except destructive actions.** Renames, moves, tags, ratings and new folders
  apply at once. Sending to Trash waits for an Apply card. Undo and Redo are prominent.

Choices made:

- **Chats stay on this device** in `chrome.storage.local`, at most 50, never synced or backed up.
  1.7.0 kept one chat for the browser session; that chat moves into the history once.
- **The Ask AI model is separate** from the Provider Settings model, per provider, so a large chat
  model does not make Auto-Tag expensive.
- **The Trash gate is in code**, not in the instructions: `sendsToTrash` in `agent_bridge.ts` stores
  such a set as pending for the built-in Ask AI client. This is also the fix for the security
  review's main finding (F1, a bookmark title steering the AI). Claude and ChatGPT keep D20's
  "apply now": their users may be on a phone, away from the Apply card.
- **Redo** replays an undone set as a new set, mapping ids a Trash restore changed, once.

**Rule:** in Ask AI, nothing goes to Trash without the user's click; model text is rendered as
plain text, and links from AI rows are http(s) only.

## D23. One AI Tools page (owner, 2026-11-10)

The owner reviewed 1.7.0 in the test browser and asked for less menu: the four AI items (AI
Settings, Ask AI, AI changes, Connect Claude or ChatGPT) became one menu item, **AI Tools**, and
the top bar's Ask AI button became the icon alone. Both open one page whose tabs are, in order:
Ask AI, Provider Settings, Auto-Tag, Smart Search, Duplicate Finder, Connect Claude or ChatGPT, AI
changes (with the count waiting for review). AI changes became a tab too because it was one of
the four items. The tabs scroll sideways at phone width. PR #19.

**Rule:** every AI surface is a tab of AI Tools (`src/components/AIToolsTabs.tsx`); do not add AI
items to the menu or the top bar.

## D22. Our own addresses, on a Cloudflare account shared with other projects (owner, 2026-11-10)

The connector and the feedback relay were reachable only at `*.sunmooncal.workers.dev`, because
the workers.dev name belongs to the whole Cloudflare account, which the owner shares across about
a dozen projects (Reply Wizard's live API among them). Options were: rename the account's
workers.dev name (breaks every Worker on it), a new Cloudflare account (new login and billing,
every link pairs again), or custom domains on palworks.ai. Chosen: custom domains,
`bookmarks-connector.palworks.ai` and `bookmarks-feedback.palworks.ai`, attached on 2026-11-10 as
hostnames of these two Workers only, then recorded in each `wrangler.toml`. The workers.dev
addresses stay on, so copies of 1.6.0 and 1.7.0 and connections made with the old address keep
working; both addresses reach the same Durable Objects. The owner's condition: the other projects
must not be disturbed in any way, which outranks this change. The product prefix (rather than
`connector.` and `feedback.`) leaves the plain names free for other projects.

**Rule:** change only these two Workers' own settings. Never the account's workers.dev name,
another Worker, or a DNS record we did not create (AGENTS rule 25).

## D21. Provider rules come from the owner's ai-provider-kit (owner, 2026-11-10)

The owner's ai-provider-kit (a separate, private repository) records measured behaviour of about
26 AI providers. Eight of its rules fixed real faults here: stale default models (Groq, DeepSeek,
Gemini, Cerebras), newer OpenAI models refusing `max_tokens` and a temperature, reasoning models
returning empty tags at a small budget, a 200 with no answer treated as success, any OpenRouter
key passing validation, out of credit reported as "wait and retry", xAI's unusual status codes,
and no retries. The owner chose to port the rules into TypeScript (`src/lib/ai_provider_rules.ts`)
rather than depend on the kit, which has no remote, no types and no licence. PR #20.

**Rule:** provider behaviour lives in that module, gated on named sets keyed `provider:model`;
when a provider misbehaves, check the kit's KNOWLEDGE.md first and port the measured rule with
its date.

## D20. The AI acts on the bookmarks itself: Ask AI and an online connector (owner, 2026-11-10)

The owner tried the 1.7.0 draft (copy a prompt into ChatGPT, paste the answer back) and found it
too much effort. New direction: the AI changes the bookmarks directly, from a chat inside the
extension or from the Claude and ChatGPT apps, phones included. Design:
[docs/designs/ai-assistant.md](docs/designs/ai-assistant.md). The owner's four answers:

**Table D20a: Owner answers that shape D20**

| Question | Answer |
|---|---|
| Which surface? | Both: **Ask AI** (a chat panel in the extension, with the user's own provider and key) first, then the online connector for Claude and ChatGPT |
| Review first, or apply now? | Apply now. Every call is one change set, validated in full, journaled, and undone in one click (chat card, AI changes, or the AI's `undo_changes`) |
| A relay of ours between Claude or ChatGPT and the browser? | Accepted, on the condition that it stores nothing it reads: the Worker keeps only a hash of each link secret, one-time authorization codes for 2 minutes, a per-minute request counter and HMAC-named network counters |
| What happens to PR #16 (the 1.7.0 draft)? | Kept as the foundation (change sets, validator, journal, Undo, local helper); copy and paste is demoted to "Other ways: copy and paste" |

How it is built:

- **One tool list** (`src/lib/bridge/tools.ts`) for Ask AI, the online connector and the local
  MCP server: `list_folders`, `list_folder`, `search`, `get_bookmark`, `apply_changes`,
  `undo_changes`, `get_change_set`. `propose_changes` is no longer an MCP tool; the CLI keeps
  `propose`.
- **One request handler** (`src/sw/agent_bridge.ts`). Ask AI calls it as the built-in client "Ask
  AI" (every folder not hidden from search); connected apps call it with the folders the user
  ticked.
- **Modes per connection**: `read`, `propose` (review first, the 1.7.0 behaviour) and `change`
  (the default for every new pairing). An agent may undo only its own change sets.
- **No new permission.** The connector uses a WebSocket from the service worker; `<all_urls>`
  already existed. `nativeMessaging` stays optional and is needed only for the local helper.

_Partly supersedes D18 and D19 where they say that every AI change waits for review: changes now
apply at once by default, and review first is a per-connection mode._

**Rule: every AI surface uses the shared tool list and the bridge's request handler, so scope,
limits and errors are the same everywhere; changes apply through `change_sets.ts` as one undoable
set; the connector Worker stores no bookmark data and no long-lived token, and deploying it needs
the owner.**

## D19. Build both stages now; how 1.7.0 implements them (owner, 2026-11-09)

The owner chose option C: build Stage 1 (AI changes by paste or file) and Stage 2 (the coding-agent
bridge) now, with no 90-day demand check. D18's order and its scope rules stand (one format, one
validator, the review panel, folder-scoped disclosure, Chrome on Linux and macOS first). Choices made
while building, each tested:

| Topic | Plan | Built | Why |
|---|---|---|---|
| Change kinds | 1a (folders, moves, renames), then 1b (tags, ratings, Trash) | All six together | Built and tested in one pass at the owner's request |
| Apply lease | `chrome.storage.session` lease with `lastProgressAt` | One promise queue; a fresh worker treats any set left `applying` as interrupted and classifies each item | Only the regular worker applies, so a new worker cannot have a job running; simpler and covered by a resume test |
| Pairing binding | Bound to the starting socket connection | Bound to a random pairing id the client keeps in its 0600 token file | The CLI and the MCP server open one connection per call, so the code arrives on a new connection; the id keeps "only the agent that asked can finish" |
| MCP server | MCP SDK | A small JSON-RPC stdio server in `bridge/src/mcp.ts` | No runtime dependencies, so `install` can copy the host out of the npx cache; the surface is 7 tools |
| Restore id map | Kept for all restores | Kept only for `ai-changes` entries, for 30 days | Other restores keep their progress writes small (existing test) |
| Real-Chrome test of the bridge | Manual | `scripts/e2e/bridge.mjs` loads a temporary copy with `nativeMessaging` required | Headless Chrome cannot click Allow on an optional permission |

**Rule: the release keeps `nativeMessaging` optional and adds no install warning
(`management.getPermissionWarningsByManifest` returns the same list as 1.6.0); publishing the npm
package and submitting 1.7.0 need the owner.**

_Partly superseded by D20: AI changes now apply at once by default (review first is a
per-connection mode), and copy and paste is demoted to "Other ways"._

## D18. AI change sets come first; the agent bridge waits for demand (autoplan gate, 2026-11-09)

The /gstack-autoplan review of [docs/designs/agent-bridge.md](docs/designs/agent-bridge.md) had
Claude and Codex agree that the review panel with one-step Undo is the part nobody else offers,
while the native bridge is the expensive part and demand for it is unproven. The owner accepted
all three challenges at the gate:

| Id | Before | Now |
|---|---|---|
| uc1 | Bridge first, then reviewed change sets | Stage 1: export chosen folders, import an AI's change set, review, apply, Undo; Stage 2 bridge only after a 90-day demand check |
| uc2 | Agents read the whole library minus hidden folders | The user picks the folders an AI may see, none by default, with an option to strip query strings |
| uc3 | Chrome, Edge and Brave on Linux, Windows and macOS | Bridge first on Chrome for Linux and macOS; the rest in Stage 3 |

_Partly superseded by D19: the owner chose to build Stage 2 now, without the demand check. Partly superseded by D20: changes from Ask AI and from
connections in "change" mode apply at once, without the review panel; they still go through one
format, one validator and the journaled apply with Undo._

**Rule: every AI change, from any source, goes through one change-set format, one validator, the
Agent changes panel and the worker's journaled apply with Undo. Nothing an AI did not get from a
folder the user picked is ever disclosed to it.**

## D17. The agent bridge uses an optional nativeMessaging permission (spike, 2026-11-09)

The agent bridge design ([docs/designs/agent-bridge.md](docs/designs/agent-bridge.md)) made a spike
the gate, because one unconfirmed report said optional `nativeMessaging` does not activate on
Chrome 156. A throwaway extension (optional `nativeMessaging`, `storage`) and a Node host
(4-byte length framing, a heartbeat every 10 s) were tested on Linux in fresh profiles:

| Check | Chrome 156.0.8078.79 | Edge 156.0.4314.58 |
|---|---|---|
| Permission prompt on request | "Communicate with cooperating native applications"; Deny is the default button | Same |
| `connectNative` after Allow, without reload | Yes | Yes (`permissions.onAdded` connected at once) |
| Host started at its registered path with `allowed_origins` = our id | Yes (origin `chrome-extension://<id>/`) | Yes (same origin form) |
| Open port keeps the service worker alive | Yes, 6 min 10 s, 38 heartbeats answered | Yes during the 25 s checked |
| Host told when the browser closes | Yes (stdin ends) | Not checked |
| Install warnings of our real manifest with optional `nativeMessaging` added | Unchanged | Not checked (same Chromium code) |
| Reconnect on `onStartup` after a browser restart | Not tested: an extension loaded through the debugging protocol does not persist across restarts | Not tested |

Not tested: Brave (not installed), Windows and macOS, and reconnect on startup. These move into
milestone 1's own tests (startup reconnect can be checked on a normal unpacked install).
Host manifests for a custom profile live in `<user-data-dir>/NativeMessagingHosts/`.

**Rule: the bridge requests `nativeMessaging` as an optional permission from a click on its
switch, never at install; it reconnects from `permissions.onAdded` and `runtime.onStartup`. The
report of it failing on Chrome 156 did not reproduce.**

## D16. Feedback goes through our own relay, never straight to the mail provider (2026-11-09)

The owner asked for a feedback form inside the extension, sent with Resend. A published
extension is a zip anyone can unpack, so a Resend key in the bundle would be a public key that
anyone could use to send mail as palworks.ai. The form posts instead to a Cloudflare Worker
(`worker/`, copied from the proven Gmail Labels as Tabs relay) that holds a send-only Resend key
scoped to the palworks.ai domain. The Worker validates hard (JSON only, 16 KB, 4,000-character
message, honeypot), accepts only our extension's origins, rate limits per network (burst binding,
5 an hour, 30 a day for everyone: owner decision 2026-11-09), stores no message content, and names networks by an HMAC of
the address (an IPv6 /64 counts as one network), never the address. The pre-landing review of
PR #11 (Claude and Codex agreeing) found the first version's KV counters non-atomic and failing
open under a flood; this relay shares the Resend account with other palworks.ai senders, so the
counters moved to a Durable Object (`worker/src/limiter.ts`) that counts exactly and refuses when
it cannot count, and a failed send gives its allowance back.

**Rule: no provider key ever ships in the extension. New network calls from the extension go to
a server we run that holds the key, and are listed in PRIVACY.md and SECURITY.md.**

## D15. Undo for rename and move lives in the toast and never overwrites a newer change (2026-11-08)

ROADMAP row 6 proposed a persisted journal of renames and moves in the worker. 1.5.0 ships the
part users reach for (Undo right after the change, by button or Ctrl/Cmd+Z) in the page, like
bulk move (D14), and defers the journal (ROADMAP row 15): it needs a history view and rules for
changes made in Chrome's manager or by sync in between, for a mistake users notice at once. Each
Undo checks first: a rename is reverted only while the item still has the name we gave it, a move
only while the item is still in the folder we moved it to. Two gaps are accepted: Chrome has no
compare-and-set, so a rename landing between the check and the write can still be overwritten,
and a reorder inside the destination folder does not block a move's Undo.

**Rule: rename and move Undo never overwrite a change made after ours; anything that cannot be
reverted says so in the toast.**

## D14. Bulk move Undo lives in the page, as long as its toast (2026-11-08)

A persisted move journal is the larger "Undo for rename and move" work (ROADMAP row 6). Bulk move
records every original position before moving, so its Undo is exact while the page is open.

**Rule: the move toast offers Undo and promises nothing beyond it; do not describe moves as
recoverable from Trash.**

## D13. History is an optional permission, read for what is on screen (2026-11-08)

Visit counts need `history`. As a required permission it would add an install warning (D3) and
disable the extension for every user until re-approved.

**Rule: `history` stays in `optional_permissions`, is requested only from a click (first call),
is checked before every use, and its data is read per visible link and never stored.**

## D12. Folder prefs are per device, keyed by folder id, exported by path (2026-11-08)

Bookmark ids differ between devices, so sync storage keyed by id would apply colours to the
wrong folders. Title paths are not unique enough to be the key.

**Rule: `fpref_<id>` lives in `chrome.storage.local`, written only by the worker; exports name
folders by title path and import applies an item only to the one folder with that exact path.
The UI says "on this device".**

## D11. Page-written metadata passes an allowlist (2026-11-08)

`META_PATCH` used to spread whatever a page sent into `meta_<url>`. Ratings and opened times made
pages write more fields, and backups feed the same path.

**Rule: every field a page or a backup may write is listed with its validator in
`src/lib/metadata_sanitize.ts`; conditional merges (backup import) run inside the worker's
per-URL queue.**

## D10. Deletes made outside the extension go to Trash too (owner direction, 2026-11-08)

The user's main remaining loss was a folder deleted in Chrome's own manager or by sync. The
Chrome behaviour this depends on was verified on Chrome 156. Recording is best effort: only while
Chrome runs on this device, and never for an account tree disappearing at sign-out or for
policy-managed bookmarks. Users can turn it off in the Trash view (default on).

**Rule: external entries are written only from `chrome.bookmarks.onRemoved`, buffered and
recorded inside the Trash queue; the extension's own removals must be marked before they
happen so they are never recorded twice.**

## D9. Licence: AGPL-3.0-only plus a paid commercial licence (owner, 2026-11-08)

The repository already offered "free (AGPL) plus commercial", 1.2.x shipped under AGPL, and
the website prices a commercial licence. PolyForm Noncommercial was the alternative; it would
have changed terms going forward only and contradicted the published pricing.

**Rule: `LICENSE` holds the unmodified AGPL 3.0 text; every source file carries
`SPDX-License-Identifier: AGPL-3.0-only`; commercial terms live in COMMERCIAL-LICENSE.md.**

## D8. Trash is owned by the service worker (owner, 2026-11-08; extended by D10)

A popup-owned Trash would race between two open tabs and lose deletes when a tab closes. The
regular-profile worker is the single writer, behind one promise queue, with `reconcile()` for
crash recovery. Capturing deletions made in Chrome's own manager was deferred: it depended on
Chrome behaviour that was untested at the time (ROADMAP row 1).

**Rule: only `src/sw/trash.ts` writes `trash_*` keys; pages send `TRASH_*` messages and refresh
on `TRASH_CHANGED`. Every delete in the UI goes through it; nothing calls
`chrome.bookmarks.remove` directly.**

## D7. Restore never chooses a storage scope by title (2026-11-08)

Chrome can hold local and account-synced bookmark trees side by side. Restoring a local
bookmark into a synced folder because their titles match would upload private data.

**Rule: a restore target must match the saved `folderType` and `syncing` (or the saved root id
on older Chrome); otherwise fail closed and ask with the Restore to... picker.**

## D6. One irreversible action, typed confirmation; everything else is Undo (2026-11-08)

Confirmation pop-ups train people to click OK. Deletes are reversible, so they get an Undo
toast; only Empty Trash is irreversible and needs the word EMPTY typed.

**Rule: no `confirm()` before a reversible action. Irreversible actions need a typed
confirmation.**

## D5. Popup listens to `TRASH_CHANGED`, not `storage.onChanged` (2026-11-08)

`storage.onChanged` delivers every write, including base64 preview images during captures.

**Rule: pages do not subscribe to `chrome.storage.onChanged`. Read with `getKeys()` (fallback
`get(null)`) plus targeted `get` calls.**

## D4. Settings import never changes where the API key is sent (2026-11-08)

A shared backup file could point `ai_custom_url` at an attacker. The key is bound to its
provider and endpoint origin (D2), and import holds `ai_provider` and `ai_custom_url` while a
key is saved.

**Rule: one allowlist (`SETTINGS_SCHEMA`) for export and import; credentials are never in it.**

## D3. No new install warnings (2026-11-07)

A new warning disables the extension for every user until they re-approve it.

**Rule: before adding a permission, compare `management.getPermissionWarningsByManifest` for the
old and new manifests (see PLAYBOOK.md). `favicon` and `alarms` were checked on Chrome 156:
identical warnings.**

## D2. The API key is bound to its provider and endpoint (1.2.1, 2026-11-08)

**Rule: read the key only with `getBoundApiKey(provider, customUrl)`; a mismatch means do not
send it.**

## D1. Storage migrations are schema-gated and shape-checked (1.2.1, 2026-11-08)

1.2.0 renamed every unknown `chrome.storage.local` key on update, which would have destroyed
saved API keys.

**Rule: never write a "rename unknown keys" migration. Bump `storage_schema_version` and move
only records with a verified legacy shape.**

## D0. The storage id of a preview is the original bookmark URL

Captured tabs can redirect. Lookups always use the bookmark's URL.

**Rule: `thumb_<url>` and `meta_<url>` use the bookmark URL, never the tab URL.**
