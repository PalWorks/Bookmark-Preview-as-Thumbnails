# Roadmap & Backlog: Bookmarks as Thumbnails

> **The single source of truth for forward-looking work.** Anything not shipped lives here. If an
> item needs more than a paragraph, write a detail file under `docs/` and link it from its row.
> Shipped history is in [CHANGELOG.md](CHANGELOG.md), rationale in [DECISIONS.md](DECISIONS.md),
> system design in [ARCHITECTURE.md](ARCHITECTURE.md).
>
> **Start at §0.** It lists every open item, one row each. §2.2 is the ledger: the same open rows
> plus every closed one.
>
> Timestamps are ISO 8601 to the second, with the offset (UTC, this is a public repository).
>
> _Last updated: 2026-11-11T04:31:04+00:00 (1.7.1 live; 1.8.0 submitted with User activity declared; audit rows 27 and 28 open)._

## 0. North star: every open item, one row each

Grouped by state (Open, Decision, Waiting, Blocked, Deferred, Recurring), then by priority.
`#` is the ledger number and never changes.

| # | Bucket | Priority | State | Size | Impact | Raised | Problem | Solution or next step |
|---|---|---|---|---|---|---|---|---|
| 8 | §3.3 | P3 | **Open** | S | L | 2026-11-08 | Older CSS still hard-codes colours, so themes are duplicated per selector. | Move App.css, TopBar.css and ThumbnailTile.css onto the tokens in `src/popup/index.css`. |
| 13 | §3.2 | P3 | **Open** | L | M | 2026-11-08 | Trash only sees deletes that happen while Chrome runs on this device; changes made while it was closed, or on a device without the extension, are not recoverable. | Spike: periodic tree snapshots on the daily alarm, diffed between runs (1.4.0 review, approach C). Compare storage cost with the event-based Trash first. |
| 11 | §3.2 | P3 | **Decision** | M | M | 2026-11-08 | The extension is a separate tab; Ctrl+Shift+O still opens Chrome's manager. | Evaluate `chrome_url_overrides.bookmarks`: check the Web Store single-purpose policy and Chrome's prompt on an unpacked build first. |
| 12 | §3.1 | P1 | **Waiting** | S | H | 2026-11-08 | 1.5.0 (which carries 1.3.0 and 1.4.0) is live on the Chrome Web Store (confirmed through the store API on 2026-11-09). The first submission was rejected on 2026-11-08 for excessive keywords; the resubmission passed. | Run PLAYBOOK release step 8 (store install on a clean profile, update from 1.2.1) once 1.6.0 is live, then row 10, the promo video link (row 16) and the website feature list. |
| 10 | §3.1 | P2 | **Open** | T | M | 2026-11-08 | The user who reported the parity gaps (email of 2026-11-06) has not been answered. | 1.5.0 and 1.6.0 are live; reply now, listing everything at once (their requests and rows 1 to 5). |
| 14 | §3.2 | P3 | **Deferred** | M | L | 2026-11-08 | Folder colours and hidden-from-search are per device (folder ids differ between devices, D12). | Comes back if users ask for them to follow sync; would need a stable folder identity across devices. |
| 15 | §3.2 | P3 | **Deferred** | M | L | 2026-11-08 | Undo for rename and move lasts as long as its toast (D15); there is no history of earlier edits. | Comes back if users ask to undo older edits: a persisted journal in the worker with a history view (the original row 6 plan). |
| 18 | §3.2 | P2 | **Done** | L | M | 2026-11-11 | 1.7.0 (Ask AI, Connect Claude or ChatGPT, coding agents; D18 to D20) is live on the Web Store at 100% (store API, 2026-11-10T20:02:43+00:00). | Post-release checks fold into row 21. |
| 26 | §3.1 | P1 | **In progress** | S | H | 2026-11-11 | 1.8.0 adds usage statistics (D27): anonymous feature events through our relay to GA4 (stream `G-Y7EQS9EYQB`) and PostHog EU (project 344404), on by default, off in Settings. The relay is deployed with both keys and checked (204 from our origin, 403 otherwise, PostHog test event accepted). The owner tested it; a full pre-release audit (2026-11-11T04:23:23+00:00) fixed one high finding (Ask AI Trash approval, SECURITY F12) and about twenty smaller ones, and the connector Worker is redeployed with its two fixes. | Tagged `v1.8.0`, uploaded, **User activity** ticked in the store's Privacy practices, submitted 2026-11-11T04:31:04+00:00 (store API: PENDING_REVIEW, automatic publishing). After approval: PLAYBOOK step 8. |
| 21 | §3.1 | P2 | **Done** | S | M | 2026-11-11 | 1.7.1 (AI Tools page D23, provider fixes D21, palworks.ai addresses D22, Ask AI side panel and chats D24, open-folder context D26, security fixes) is live on the Web Store at 100% (store API, 2026-11-11); helper 1.7.2 (D25) is on npm (`latest`). | PLAYBOOK step 8 together with 1.8.0 (row 26). |
| 25 | §3.3 | P2 | **Done** | S | M | 2026-11-11 | Security review F3 and F7 decided by the owner: F3 accepted (Workers stay on the shared Cloudflare account); F7 fixed in the helper (D25). | Shipped: helper 1.7.2 is `latest` on npm (2026-11-11). |
| 27 | §3.3 | P3 | **Open** | S | L | 2026-11-11 | 1.8.0 audit, left open: in split incognito the two workers each queue `meta_*` writes, so a rating and an Auto-Tag on one link at the same moment can lose one (SECURITY F17); only `StorageIndex.clear` and `remove` and a few exports are used by tests alone. | Route incognito `META_PATCH` to the regular worker, or document; prune test-only code when next touched. |
| 28 | §3.2 | P3 | **Open** | M | M | 2026-11-11 | 1.8.0 audit, left open: the Settings, Filter and Sort menus and the AI Tools tabs lack arrow-key navigation; Settings menu labels mix Title Case and sentence case. | Share `ContextMenu`'s keyboard logic with the top bar menus; add tabpanel roles and arrow keys; pick one label case and update the store listing text with it. |
| 24 | §3.3 | P3 | **Open** | S | M | 2026-11-10 | Security review F2 and F6: connector tokens never expire; failed tokens use up a link's per-minute budget. | Expire a token after 90 days unused; count failed tokens separately in the link's Durable Object. Needs a Worker deploy. |
| 17 | §3.1 | P2 | **In progress** | S | M | 2026-11-09 | 1.6.0 (settings menu rework, in-built feedback form via the `worker/` relay) is live on the Web Store at 100% (confirmed through the store API at 2026-11-09T16:13:49+00:00); submitted 2026-11-09T13:56:04+00:00. The Privacy tab now declares personally identifiable information (the optional reply address) and personal communications (the feedback message). | PLAYBOOK release step 8 (store install on a clean profile, update from 1.5.0), then rows 10 and 16 and the website feature list. |
| 16 | §3.1 | P3 | **In progress** | S | M | 2026-11-09 | Five new 1280x800 screenshots of 1.5.0 on a demo library were approved by the owner and are in the listing (submitted with the 1.5.0 resubmission). A 63 s promo video is made. | The owner uploads the video to YouTube; then add its URL as the listing's Global promo video. |

**Reading the narrow columns.** Bucket is the §3 area: 3.1 Release, 3.2 Features, 3.3 Engineering.
Size: T trivial, S small, M medium, L large, ? unknown. Impact: H high, M medium, L low.

### Legend

**Priority** (how much it hurts):

| Priority | Means |
|---|---|
| **P0** | A live customer is losing something today |
| **P1** | Costs a support ticket, real money or a release every time it happens |
| **P2** | The product is measurably worse without it |
| **P3** | Worth doing; nothing breaks if it waits |

**Impact** (what it costs not to do):

| Impact | Means |
|---|---|
| **High** | Costs activations, refunds, revenue, or a customer meeting a defect |
| **Medium** | Costs support hours, or blocks something High |
| **Low** | Real, and nobody is bleeding |

Priority, Size and Impact are separate columns because they answer separate questions.

**State** (closed vocabulary; use no other word):

| State | Means |
|---|---|
| **Open** | Not started or partly done; nothing stops it but a decision to begin |
| **Blocked** | Cannot proceed until someone outside the project acts or changes a policy; the row names who |
| **Waiting** | Ready, and deliberately held until a named date (a measurement window, a staged rollout) |
| **Deferred** | Could proceed, and the owner has chosen not to yet (usually new spend, or no demand); the row says what would bring it back |
| **Decision** | An answer from the owner is needed first; the row carries a recommendation |
| **Recurring** | A procedure that runs again every release or on a date; the row records the last run |
| **Done** | Closed, with the date and the size it turned out to be (ledger only) |

## How to keep this file current

| When | Do this |
|---|---|
| An item closes | Move its ledger row to the Done block with `**Done** <date>` and `Was <size>`, remove it from §0, delete its §8 subsection. Never delete the ledger row |
| An item is found | Add it to §0 and the ledger with the next unused number, and to its §3 area if it needs context |
| The owner answers a Decision | Update the §0 row and the ledger row the same day |
| A state changes | Change it in §0 and the ledger together |
| A release or milestone ships | Update §2.1, close the rows it shipped, update §1 |
| Anything above happens | Update the header's `_Last updated_` line with the timestamp and what changed |

---

## 1. Shipped capabilities

| Capability | Since |
|---|---|
| Thumbnail grid and list for bookmarks, batch capture, dark mode, JSON backup | 1.0 |
| AI Auto-Tag, Smart Search, Duplicate Finder (on-device or bring your own key) | 1.2.0 |
| Safe updates (schema-gated migration), tags kept on recapture, API key bound to its provider | 1.2.1 (live 2026-11-08) |
| Trash with Undo, favicon previews, deep counts, folder panel toggle, 360px layout, settings export | 1.3.0 (not released on its own; ships in 1.5.0) |
| Deletes made outside the extension in Trash, folder colours, hidden from search, multi-select with bulk delete/move/open, list columns and ratings | 1.4.0 (not released on its own; ships in 1.5.0) |
| Undo for rename and Cut and Paste | 1.5.0 (live; confirmed through the store API 2026-11-09) |
| Settings menu rework, in-built feedback form (relay in `worker/`), html2canvas-pro capture | 1.6.0 (live 2026-11-09) |
| Ask AI, Connect Claude or ChatGPT, coding agents, AI changes with Undo | 1.7.0 (live 2026-11-10) |
| One AI Tools page, Ask AI side panel with saved chats and the open folder, provider and security fixes | 1.7.1 (live 2026-11-11) |
| Anonymous usage statistics with an off switch (D27), pre-release audit fixes | 1.8.0 (in review since 2026-11-11) |

## 2. Next up

### 2.1 Status: 1.8.0 in Web Store review, 1.7.1 live (updated 2026-11-11T04:31:04+00:00)

1.7.0 and 1.7.1 are live at 100% (1.7.1 passed review before 1.8.0 was uploaded). 1.8.0 adds
usage statistics (D27) and the fixes from a full pre-release audit (SECURITY F12 to F17), and was
submitted on 2026-11-11T04:31:04+00:00 with automatic publishing (row 26). The relay side is live: the
feedback Worker's `/events` forwards to GA4 stream `G-Y7EQS9EYQB` (property "Bookmarks as
Thumbnails Website") and PostHog EU project 344404, both keys held as Worker secrets. Helper
1.7.2 is `latest` on npm. The store's Privacy practices now tick **User activity**
(PRIVACY_DETAILS 4a). The connector Worker was redeployed from `main` with the audit's two fixes.

The 1.7.1 status, kept for reference:

Since the 1.7.0 submission, `main` gained the next release (row 21): one **AI Tools** page that
replaces four menu items (D23, PR #19), the provider rules from the owner's ai-provider-kit
(D21, PR #20) and our own addresses, `bookmarks-connector.palworks.ai` and
`bookmarks-feedback.palworks.ai` (D22, row 23). Both Workers were redeployed from `main` on
2026-11-10 and serve the old workers.dev addresses too, so 1.7.0 keeps working. The helper is at
`bookmarks-thumbnails-mcp@1.7.1` on npm and the stray `0.0.0-stage` is deprecated (row 22). The
release waits for 1.7.0's approval, because uploading now would cancel that review.

The 1.7.0 status, kept for reference:

1.7.0 (Ask AI, Connect Claude or ChatGPT, coding agents; row 18) was merged (PR #16), tagged
`v1.7.0`, published to npm as `bookmarks-thumbnails-mcp@1.7.0` and submitted to the Web Store at
2026-11-10T06:33:36+00:00 with automatic publishing. The connector Worker is live (row 19) and the Privacy tab,
listing and test instructions were updated (row 20). Real Claude and ChatGPT accounts passed
connect, read, change and Undo on 2026-11-10. Left: PLAYBOOK release step 8 after approval.

The 1.6.0 status, kept for reference:


1.6.0 is live at 100% (confirmed through the store API at 2026-11-09T16:13:49+00:00). It was merged (PR #11),
tagged `v1.6.0`, uploaded and submitted on 2026-11-09T13:56:04+00:00 with automatic publishing;
the Privacy tab now declares personally identifiable information and personal communications
for the feedback form (row 17). Left: PLAYBOOK release step 8, the reply to the user
who asked for these features (row 10), the promo video link (row 16) and the website feature
list. The next feature is Agent changes, Stage 1 (row 18), whose plan was approved on
2026-11-09.

The 1.5.0 history, kept for reference:

1.2.1 is live. The owner chose to ship 1.3.0 and 1.4.0 inside 1.5.0 rather than on their own
(2026-11-08): PRs #2, #3 and #5 are merged, `v1.4.0` and `v1.5.0` are tagged, and 1.5.0 was
submitted for review on 2026-11-08 with automatic publishing after approval. That submission was rejected the same day for excessive keywords (AI provider names in the description); the description was fixed, new screenshots added, and it was resubmitted on 2026-11-09. No permissions
changed between 1.4.0 and 1.5.0; install warnings are identical to 1.2.1. Before submission:
338 tests, lint, build, bundle check (no keys, no source maps) and `npm run e2e` passed, and the
update from 1.2.1 to 1.5.0 (AI key, tags, Trash, alarm, Undo, 360px layout, no console errors)
passed in headless Chrome. Every dashboard page was reviewed; the description was rewritten for
1.3.0 to 1.5.0, reviewer test instructions were added, and the website privacy policy was
brought in line with PRIVACY.md (PR #6). The store screenshots are still the old ones (row 16).
Design and review record:
[docs/designs/release-1.4.0-organise-and-recover.md](docs/designs/release-1.4.0-organise-and-recover.md).

### 2.2 The ledger: every backlog item, pending first, done at the bottom

**This table is authoritative for STATE; §3 and §8 are authoritative for REASONING.** Open rows
repeat §0 in one line; §0 holds the problem and solution. Closed rows keep only their date and size.

| # | Item | Section | State | Size | Impact |
|---|---|---|---|---|---|
| 8 | Migrate older CSS to design tokens | §3.3 | **Open** | S | L |
| 13 | Recover changes made while Chrome was closed (snapshots) | §3.2 | **Open** | L | M |
| 12 | Release 1.5.0 (with 1.3.0 and 1.4.0) to the Web Store | §3.1 | **Waiting**: live; post-release checks together with 1.6.0 | S | H |
| 26 | Release 1.8.0: usage statistics (GA4 and PostHog through our relay), with everything from 1.7.1 | §3.1 | **In progress**: in Web Store review | S | H |
| 18 | Ask AI, Connect Claude or ChatGPT, coding agents (1.7.0) | §3.2 | **Done**: live at 100% | L | M |
| 21 | Release 1.7.1: AI Tools page, Ask AI side panel and chats, provider fixes, security fixes, palworks.ai addresses | §3.1 | **Done**: live at 100% | S | M |
| 25 | Security decisions: Cloudflare account (F3), helper detection (F7) | §3.3 | **Done**: F3 accepted, F7 fixed (D25) | S | M |
| 27 | Incognito metadata write race; test-only code | §3.3 | **Open** | S | L |
| 28 | Keyboard navigation in top bar menus and AI Tools tabs; one label case | §3.2 | **Open** | M | M |
| 24 | Connector token expiry and failed-token budget (F2, F6) | §3.3 | **Open** | S | M |
| 17 | Release 1.6.0 (menu rework, feedback form) | §3.1 | **In progress**: live; release step 8 left | S | M |
| 16 | Refresh store screenshots | §3.1 | **In progress**: promo video link left | S | M |
| 11 | Open this UI from Chrome's bookmark manager shortcut | §3.2 | **Decision** | M | M |
| 10 | Reply to the user who requested parity | §3.1 | **Open**: 1.6.0 is live, reply can go | T | M |
| 14 | Folder prefs across devices | §3.2 | **Deferred** | M | L |
| 15 | Undo history beyond the toast | §3.2 | **Deferred** | M | L |
| 23 | Own addresses for the connector and the relay (custom domains on palworks.ai) | §3.3 | **Done** 2026-11-10 (D22; both Workers redeployed from `main`) | Was S | M |
| 22 | Helper 1.7.1 (finds unpacked copies and Chrome data folders) and deprecate the npm placeholder `0.0.0-stage` | §3.1 | **Done** 2026-11-10 (PR #18) | Was S | M |
| 20 | Web Store privacy update for 1.7.0 | §3.1 | **Done** 2026-11-10 | Was S | H |
| 19 | Deploy the online connector Worker | §3.1 | **Done** 2026-11-10 | Was S | H |
| 1 | Record deletions made outside the extension | §3.2 | **Done** 2026-11-08 (built in 1.4.0, ships with row 12) | Was M | M |
| 2 | Exclude chosen folders from search | §3.2 | **Done** 2026-11-08 (1.4.0) | Was S | M |
| 3 | List view columns | §3.2 | **Done** 2026-11-08 (1.4.0) | Was M | M |
| 4 | Range multi-select with bulk actions | §3.2 | **Done** 2026-11-08 (1.4.0) | Was M | M |
| 5 | Per-folder colours | §3.2 | **Done** 2026-11-08 (1.4.0) | Was S | L |
| 6 | Undo for rename and move | §3.2 | **Done** 2026-11-08 (built in 1.5.0, `release/1.5.0`; toast Undo, journal deferred as row 15) | Was M | L |
| 7 | Real-Chrome checks in CI | §3.3 | **Done** 2026-11-08 (CI job "Real-Chrome smoke test") | Was S | M |
| 9 | Release 1.3.0 to the Web Store | §3.1 | **Done** 2026-11-08 (ships inside 1.4.0, row 12) | Was S | H |

---

## 3. Backlog by area

### 3.1 Release

Release steps are in [PLAYBOOK.md](PLAYBOOK.md).

### 3.2 Features

Rows 1 to 5 (the 2026-11-06 user email, items 2, 5, 7 and 9, plus recovery of deletes made in
Chrome) are built in 1.4.0. Row 13 is the larger safety-net idea from the 1.4.0 review; row 14 is
the per-device limit of folder prefs (DECISIONS D12).

### 3.3 Engineering

Rows 7 and 8 are debt recorded during the 1.3.0 review. Row 7 is done: `npm run e2e` runs in CI
as the "Real-Chrome smoke test" job (Node 22, the runner's Chrome, `--no-sandbox` via
`E2E_NO_SANDBOX=1`).

## 5. Not doing: decided against, with the reason

| Item | Why |
|---|---|
| `minimum_chrome_version` 130 for `storage.getKeys` | A `get(null)` fallback keeps older Chrome working (decision 34 in the 1.3.0 design). |
| Per-entry permanent delete in Trash | One irreversible path only (Empty Trash with typed confirmation), 1.3.0 design decision 19. |

## 6. Where the detail lives

4 documents:

| Document | Covers |
|---|---|
| [docs/designs/ai-assistant.md](docs/designs/ai-assistant.md) | Ask AI and the online connector (D20): rules, OAuth flow, limits (row 18) |
| [docs/designs/agent-bridge.md](docs/designs/agent-bridge.md) | AI change sets and the coding-agent bridge (D18, D19), with its review record (row 18) |
| [docs/designs/release-1.4.0-organise-and-recover.md](docs/designs/release-1.4.0-organise-and-recover.md) | 1.4.0 design, CEO, design and engineering reviews with both models, the final build spec |
| [docs/designs/release-1.3.0-safe-delete-and-parity.md](docs/designs/release-1.3.0-safe-delete-and-parity.md) | 1.3.0 design, reviews, decisions, and the deferred external-capture notes (row 1) |

## 7. Closed, kept for the reasoning

None yet.
