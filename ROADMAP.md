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
> _Last updated: 2026-11-08T13:24:59+00:00 (1.4.0 built and verified: rows 1 to 5 done on the branch; rows 12 to 14 added)._

## 0. North star: every open item, one row each

Grouped by state (Open, Decision, Waiting, Blocked, Deferred, Recurring), then by priority.
`#` is the ledger number and never changes.

| # | Bucket | Priority | State | Size | Impact | Raised | Problem | Solution or next step |
|---|---|---|---|---|---|---|---|---|
| 7 | §3.3 | P2 | **Open** | S | M | 2026-11-08 | The real-Chrome checks run locally (`npm run e2e`, added in 1.4.0) but not in CI. | Add a CI job that installs Chrome and runs `npm run e2e` after the build; it needs `--enable-unsafe-extension-debugging` on the runner. |
| 6 | §3.2 | P3 | **Open** | M | L | 2026-11-08 | Rename and single move have no Undo; bulk move's Undo lasts only as long as its toast (D14). | Extend the Trash operation journal to rename and move, persisted in the worker. |
| 8 | §3.3 | P3 | **Open** | S | L | 2026-11-08 | Older CSS still hard-codes colours, so themes are duplicated per selector. | Move App.css, TopBar.css and ThumbnailTile.css onto the tokens in `src/popup/index.css`. |
| 13 | §3.2 | P3 | **Open** | L | M | 2026-11-08 | Trash only sees deletes that happen while Chrome runs on this device; changes made while it was closed, or on a device without the extension, are not recoverable. | Spike: periodic tree snapshots on the daily alarm, diffed between runs (1.4.0 review, approach C). Compare storage cost with the event-based Trash first. |
| 9 | §3.1 | P1 | **Decision** | S | H | 2026-11-08 | 1.3.0 is built and verified on `release/1.3.0` (also on the owner's profile); users get Trash and the parity fixes only once it is submitted. | 1.2.1 is live, nothing is in review. Recommendation: merge PR #2, tag v1.3.0 and submit. Owner decides. |
| 12 | §3.1 | P1 | **Decision** | S | H | 2026-11-08 | 1.4.0 (rows 1 to 5) is built and verified on `release/1.4.0`, stacked on 1.3.0. Both review models suggested shipping 1.3.0 first and waiting for feedback before 1.4.0. | Recommendation: submit 1.3.0 now, then 1.4.0 once 1.3.0 is approved (about a week), so a problem in either release is easy to place. Owner decides. |
| 11 | §3.2 | P3 | **Decision** | M | M | 2026-11-08 | The extension is a separate tab; Ctrl+Shift+O still opens Chrome's manager. | Evaluate `chrome_url_overrides.bookmarks`: check the Web Store single-purpose policy and Chrome's prompt on an unpacked build first. |
| 10 | §3.1 | P2 | **Waiting** | T | M | 2026-11-08 | The user who reported the parity gaps (email of 2026-11-06) has not been answered. | Reply once 1.3.0 is live, listing what shipped and that their remaining requests (rows 1 to 5) are built for 1.4.0. |
| 14 | §3.2 | P3 | **Deferred** | M | L | 2026-11-08 | Folder colours and hidden-from-search are per device (folder ids differ between devices, D12). | Comes back if users ask for them to follow sync; would need a stable folder identity across devices. |

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
| Trash with Undo, favicon previews, deep counts, folder panel toggle, 360px layout, settings export | 1.3.0 (built, not yet released) |
| Deletes made outside the extension in Trash, folder colours, hidden from search, multi-select with bulk delete/move/open, list columns and ratings | 1.4.0 (built, not yet released) |

## 2. Next up

### 2.1 Status: 1.3.0 and 1.4.0 built and verified, releases pending rows 9 and 12 (updated 2026-11-08T13:24:59+00:00)

1.2.1 is live on the Chrome Web Store. 1.3.0 is on `release/1.3.0` (PR #2). 1.4.0 is on
`release/1.4.0`, stacked on 1.3.0: 322 tests, lint, build, bundle check and `npm run e2e` pass;
the update from 1.3.0, the permission gate (identical install warnings), deletes made outside the
extension, selection, columns and dialogs were checked in headless Chrome 156 and again on the
owner's profile (794 bookmarks, unchanged afterwards). Design and review record:
[docs/designs/release-1.4.0-organise-and-recover.md](docs/designs/release-1.4.0-organise-and-recover.md).

### 2.2 The ledger: every backlog item, pending first, done at the bottom

**This table is authoritative for STATE; §3 and §8 are authoritative for REASONING.** Open rows
repeat §0 in one line; §0 holds the problem and solution. Closed rows keep only their date and size.

| # | Item | Section | State | Size | Impact |
|---|---|---|---|---|---|
| 7 | Real-Chrome checks in CI | §3.3 | **Open** | S | M |
| 6 | Undo for rename and move | §3.2 | **Open** | M | L |
| 8 | Migrate older CSS to design tokens | §3.3 | **Open** | S | L |
| 13 | Recover changes made while Chrome was closed (snapshots) | §3.2 | **Open** | L | M |
| 9 | Release 1.3.0 to the Web Store | §3.1 | **Decision** | S | H |
| 12 | Release 1.4.0 to the Web Store | §3.1 | **Decision** | S | H |
| 11 | Open this UI from Chrome's bookmark manager shortcut | §3.2 | **Decision** | M | M |
| 10 | Reply to the user who requested parity | §3.1 | **Waiting**: until 1.3.0 is live | T | M |
| 14 | Folder prefs across devices | §3.2 | **Deferred** | M | L |
| 1 | Record deletions made outside the extension | §3.2 | **Done** 2026-11-08 (built in 1.4.0, ships with row 12) | Was M | M |
| 2 | Exclude chosen folders from search | §3.2 | **Done** 2026-11-08 (1.4.0) | Was S | M |
| 3 | List view columns | §3.2 | **Done** 2026-11-08 (1.4.0) | Was M | M |
| 4 | Range multi-select with bulk actions | §3.2 | **Done** 2026-11-08 (1.4.0) | Was M | M |
| 5 | Per-folder colours | §3.2 | **Done** 2026-11-08 (1.4.0) | Was S | L |

---

## 3. Backlog by area

### 3.1 Release

Release steps are in [PLAYBOOK.md](PLAYBOOK.md).

### 3.2 Features

Rows 1 to 5 (the 2026-11-06 user email, items 2, 5, 7 and 9, plus recovery of deletes made in
Chrome) are built in 1.4.0. Row 13 is the larger safety-net idea from the 1.4.0 review; row 14 is
the per-device limit of folder prefs (DECISIONS D12).

### 3.3 Engineering

Rows 7 and 8 are debt recorded during the 1.3.0 review; 1.4.0 added the local half of row 7
(`npm run e2e`).

## 5. Not doing: decided against, with the reason

| Item | Why |
|---|---|
| `minimum_chrome_version` 130 for `storage.getKeys` | A `get(null)` fallback keeps older Chrome working (decision 34 in the 1.3.0 design). |
| Per-entry permanent delete in Trash | One irreversible path only (Empty Trash with typed confirmation), 1.3.0 design decision 19. |

## 6. Where the detail lives

2 documents:

| Document | Covers |
|---|---|
| [docs/designs/release-1.4.0-organise-and-recover.md](docs/designs/release-1.4.0-organise-and-recover.md) | 1.4.0 design, CEO, design and engineering reviews with both models, the final build spec |
| [docs/designs/release-1.3.0-safe-delete-and-parity.md](docs/designs/release-1.3.0-safe-delete-and-parity.md) | 1.3.0 design, reviews, decisions, and the deferred external-capture notes (row 1) |

## 7. Closed, kept for the reasoning

None yet.
