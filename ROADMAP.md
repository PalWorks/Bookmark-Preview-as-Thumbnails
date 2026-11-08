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
> _Last updated: 2026-11-08T12:18:14+00:00 (1.3.0 verified on the owner's profile; licence confirmed by the owner)._

## 0. North star: every open item, one row each

Grouped by state (Open, Decision, Waiting, Blocked, Deferred, Recurring), then by priority.
`#` is the ledger number and never changes.

| # | Bucket | Priority | State | Size | Impact | Raised | Problem | Solution or next step |
|---|---|---|---|---|---|---|---|---|
| 1 | §3.2 | P2 | **Open** | M | M | 2026-11-08 | Bookmarks deleted in Chrome's own manager or by sync cannot be recovered from Trash. | Build on the 1.3.0 coordinator. Chrome 156 facts verified 2026-11-08: one `onRemoved` per removed root, with the full subtree in `node`. Still open: incognito storage sharing, and hiding Restore for synced removals after sign-out. |
| 2 | §3.2 | P2 | **Open** | S | M | 2026-11-08 | Utility folders (for example bookmarklets) pollute search results (user request, item 5). | Store excluded folder ids in sync storage; filter `bookmarks.search` results by an ancestor set built from the in-memory tree. |
| 3 | §3.2 | P2 | **Open** | M | M | 2026-11-08 | List view lacks "last opened", date created, a rating and visit count (user request, item 7). | Columns from `dateLastUsed` and `dateAdded` (no new permission); visit count needs the optional `history` permission, requested only when that column is turned on. |
| 4 | §3.2 | P2 | **Open** | M | M | 2026-11-08 | No range selection or bulk actions (user request, item 9). | Selection model in a new hook; bulk delete goes through the Trash service as one operation. |
| 7 | §3.3 | P2 | **Open** | M | M | 2026-11-08 | Chrome-only behaviour (update path, Trash, 360px layout) is checked with ad hoc CDP scripts, not in CI. | Playwright harness that loads `dist/` in Chromium and runs the update, delete and Undo, restore and 360px checks. |
| 5 | §3.2 | P3 | **Open** | S | L | 2026-11-08 | All folders are the same yellow; users want colours (user request, item 2). | Store `{ folderId: colour }` in sync storage and reuse the 1.3.0 folder tokens. |
| 6 | §3.2 | P3 | **Open** | M | L | 2026-11-08 | Rename and move have no Undo, unlike delete. | Extend the Trash operation journal to rename, cut and paste, and move. |
| 8 | §3.3 | P3 | **Open** | S | L | 2026-11-08 | Older CSS still hard-codes colours, so themes are duplicated per selector. | Move App.css, TopBar.css and ThumbnailTile.css onto the tokens in `src/popup/index.css`. |
| 9 | §3.1 | P1 | **Decision** | S | H | 2026-11-08 | 1.3.0 is built and verified on branch `release/1.3.0` (also on the owner's own profile, 2026-11-08T12:18:14+00:00); users get the Trash and parity fixes only once it is submitted. | 1.2.1 is live (Web Store PUBLISHED, checked 2026-11-08T09:14:11+00:00), so nothing is in review. Recommendation: merge PR #2, tag v1.3.0 and submit. Owner decides. |
| 11 | §3.2 | P3 | **Decision** | M | M | 2026-11-08 | The extension is a separate tab; Ctrl+Shift+O still opens Chrome's manager. | Evaluate `chrome_url_overrides.bookmarks`: check the Web Store single-purpose policy and Chrome's prompt on an unpacked build first. Recommendation: spike only after rows 1 to 4. |
| 10 | §3.1 | P2 | **Waiting** | T | M | 2026-11-08 | The user who reported the parity gaps (email of 2026-11-06) has not been answered. | Reply once 1.3.0 is live on the Web Store, listing what shipped and what is planned (rows 1 to 4). |

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

## 2. Next up

### 2.1 Status: 1.3.0 built and verified, release pending row 9 (updated 2026-11-08T12:18:14+00:00)

1.2.1 is live on the Chrome Web Store. 1.3.0 is on `release/1.3.0`: 257 tests, lint, build and
bundle check pass; update from 1.2.1, Trash flows and layouts verified on Chrome 156, then
again on the owner's own profile (794 bookmarks, 29 folders, local only): update in place,
delete, Undo, Delete key, Ctrl+Z, Trash, Restore, Restore to..., Empty Trash, search, list and
grid at 360 to 1920px in both themes, Duplicate Finder scan, no console errors, bookmarks
unchanged afterwards. Five small fixes from that pass are in the 1.3.0 CHANGELOG.

### 2.2 The ledger: every backlog item, pending first, done at the bottom

**This table is authoritative for STATE; §3 and §8 are authoritative for REASONING.** Open rows
repeat §0 in one line; §0 holds the problem and solution. Closed rows keep only their date and size.

| # | Item | Section | State | Size | Impact |
|---|---|---|---|---|---|
| 1 | Record deletions made outside the extension | §3.2 | **Open** | M | M |
| 2 | Exclude chosen folders from search | §3.2 | **Open** | S | M |
| 3 | List view columns | §3.2 | **Open** | M | M |
| 4 | Range multi-select with bulk actions | §3.2 | **Open** | M | M |
| 7 | Automated browser E2E for the extension | §3.3 | **Open** | M | M |
| 5 | Per-folder colours | §3.2 | **Open** | S | L |
| 6 | Undo for rename and move | §3.2 | **Open** | M | L |
| 8 | Migrate older CSS to design tokens | §3.3 | **Open** | S | L |
| 9 | Release 1.3.0 to the Web Store | §3.1 | **Decision** | S | H |
| 11 | Open this UI from Chrome's bookmark manager shortcut | §3.2 | **Decision** | M | M |
| 10 | Reply to the user who requested parity | §3.1 | **Waiting**: until 1.3.0 is live | T | M |

---

## 3. Backlog by area

### 3.1 Release

Release steps are in [PLAYBOOK.md](PLAYBOOK.md).

### 3.2 Features

Rows 2 to 5 come from the 2026-11-06 user email (items 2, 5, 7 and 9). Row 1 was chosen by the
owner in office hours and deferred from 1.3.0 at the review gate because it depended on untested
Chrome behaviour; part of that is now verified (see ARCHITECTURE.md).

### 3.3 Engineering

Rows 7 and 8 are debt recorded during the 1.3.0 review.

## 5. Not doing: decided against, with the reason

| Item | Why |
|---|---|
| `minimum_chrome_version` 130 for `storage.getKeys` | A `get(null)` fallback keeps older Chrome working (decision 34 in the 1.3.0 design). |
| Per-entry permanent delete in Trash | One irreversible path only (Empty Trash with typed confirmation), 1.3.0 design decision 19. |

## 6. Where the detail lives

1 document:

| Document | Covers |
|---|---|
| [docs/designs/release-1.3.0-safe-delete-and-parity.md](docs/designs/release-1.3.0-safe-delete-and-parity.md) | 1.3.0 design, reviews, decisions, and the deferred external-capture notes (row 1) |

## 7. Closed, kept for the reasoning

None yet.
