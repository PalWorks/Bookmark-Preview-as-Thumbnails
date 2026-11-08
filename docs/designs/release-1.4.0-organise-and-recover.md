<!-- /autoplan restore point: /home/palani/.gstack/projects/PalWorks-Bookmark-Preview-as-Thumbnails/release-1.4.0-autoplan-restore-20261108-175145.md -->
# Design: Release 1.4.0, organise and recover

_Created: 2026-11-08T12:20:43+00:00. Status: draft for review (autoplan)._

Base: `release/1.3.0` (Trash, Undo, parity). Source of scope: ROADMAP rows 1 to 5, which come
from the 2026-11-06 user email (items 2, 5, 7, 9) and the external-capture work deferred from
1.3.0.

## Problem statement

1. **Deletes made outside this extension are lost.** Trash only covers deletes made in this
   extension. A folder deleted in Chrome's own manager (Ctrl+Shift+O), on another synced
   device, or by a sync conflict cannot be recovered here. (ROADMAP row 1.)
2. **Utility folders pollute search.** Bookmarklets and reference folders show up in every
   search. The user wants to exclude chosen folders from search. (Row 2, email item 5.)
3. **List view hides useful facts.** No date added, no "last opened", no personal rating, no
   visit count. (Row 3, email item 7.)
4. **One item at a time.** No range selection, so deleting or moving twenty bookmarks takes
   twenty round trips. (Row 4, email item 9.)
5. **Every folder is the same yellow.** Users who organise by colour cannot. (Row 5, email
   item 2, the part not shipped in 1.3.0.)

## Verified platform facts (Chrome 156, 2026-11-08)

| Fact | How verified |
|---|---|
| `bookmarks.removeTree` fires one `onRemoved` whose `node` holds the full subtree | 1.3.0 QA, real Chrome |
| Bookmark nodes carry `folderType` and `syncing` on permanent folders, `syncing` on every node | 1.3.0 QA and the owner's profile |
| `dateLastUsed` is absent on all 794 bookmarks of a real profile; Chrome sets it only when a bookmark is opened from Chrome's own bookmark UI | Owner's profile, 2026-11-08 |
| Opening a link from this extension does not set `dateLastUsed` | Same (the profile has used this extension) [Inference from the absent field] |
| `chrome.history` is undefined without the `history` permission | Owner's profile |
| Bookmark ids are local to one device; synced bookmarks get different ids on each machine | Chrome documentation [Unverified here] |

## Constraints

- No new install warning (DECISIONS D3). `history` may only be an **optional** permission,
  requested when the user turns on the Visits column, and checked with the permission gate.
- Only `src/sw/trash.ts` writes `trash_*` keys (D8). External capture lives there.
- Pages do not subscribe to `chrome.storage.onChanged` (D5).
- Restore never picks a storage scope by title (D7).
- Mobile first: 360px, 40px targets, labels on key actions, Undo over confirmation (D6).
- No keys, no source maps, bundle check stays green. Worker bundle stays free of React/DOM.

## Approaches considered

| Approach | Summary | Verdict |
|---|---|---|
| A. Ship all five rows together as 1.4.0 | One release, one update notice, one permission gate | **Chosen**: the rows share plumbing (folder prefs, selection, list columns) and each is S or M |
| B. Split: 1.4.0 = rows 1 and 4 (recovery, bulk), 1.5.0 = rows 2, 3, 5 | Smaller diff per release | Rejected: two Web Store reviews for one user's request list; rows 2 and 5 share the folder-prefs store |
| C. Rows 2 to 5 only, keep external capture deferred | Avoids sync edge cases | Rejected: "deleted in Chrome's manager" is the main gap Trash still has, and the Chrome facts it depended on are now verified |

## Recommended design

> **Superseded in places.** The review below changed F1, F3 and F4. The "Final build spec" at
> the end of this document is authoritative wherever it differs from this section.

### F1. Record deletions made outside this extension (row 1)

- `chrome.bookmarks.onRemoved` listener at worker top level, regular worker only
  (`!IS_INCOGNITO_WORKER`), routed to `trash.recordExternal(id, removeInfo)`.
- `recordExternal` runs inside the Trash queue, so an event caused by the extension's own
  `deleteNow` is processed after that delete has written its entry. It ignores the event when:
  - `removeInfo.node` is missing, or the removed node is permanent (`parentId === '0'`);
  - an entry (any state) already has `tree.oldId === id` (the extension's own delete; the
    snapshot is always written before removal, so this survives a worker restart);
  - the setting **Keep items deleted elsewhere** is off (`trashExternal`, sync storage,
    default on).
- Scope: resolved from the parent at event time (`getNode(parentId)` then its permanent
  root). If the parent no longer exists (a whole account tree going away on sign-out, or a
  parent removed in the same burst), the entry keeps `scope.rootId = parentId` and no
  `folderType`, so restore fails closed into **Restore to...** (D7). [Inference: Chrome removes
  account folders on sign-out; not tested.]
- Grouping: one operation per burst. A persisted `trash_ext_op = { operationId, lastAt,
  roots, dropped }` record; events within 2 seconds of `lastAt` join it. At most 200 roots per
  operation; beyond that only `dropped` increases and the row says "and N more not kept".
  This keeps a sync wipe or "delete all" from flooding storage.
- Entry `origin: 'external'`. Trash row wording: "Deleted outside this extension". Never
  auto-restored. Restore uses the existing resolver (D7 still applies).
- Asset sweep: external entries reference the same `thumb_`/`meta_` URLs; the existing sweep
  already keeps assets for URLs referenced by any Trash entry.
- Folder prefs (F5) of removed folders are carried into the entry, and re-applied on restore.

### F2. Exclude folders from search (row 2)

- Context menu on a folder: **Hide from search** / **Show in search**. Sidebar shows a small
  "hidden from search" icon with a tooltip and an accessible label.
- Search (`chrome.bookmarks.search`) results drop nodes inside an excluded folder, using an
  ancestor walk over a parent map built from the tree already in memory.
- When results were hidden, the results header says "N results in hidden folders" with a
  **Show them** button that includes them for this search only.
- AI Smart Search results get the same filter. Duplicate Finder is unchanged (finding
  duplicates across every folder is its job).

### F3. Folder prefs store (shared by F2 and F5)

- One key per folder: `fpref_<folderId> = { color?: FolderColor; hideFromSearch?: true }` in
  `chrome.storage.local` (ids are device-local, so not sync storage). Per-key writes avoid a
  read-modify-write race between two open tabs.
- Read once on load (`getKeys` prefix scan, `get(null)` fallback as in Trash) and refreshed on
  the existing bookmark-event refresh. Stale keys (folder gone and not in Trash) are pruned on
  load.
- Written from the page through a small `folderPrefs` module (`src/lib/folder_prefs.ts`),
  DOM-free so the worker can read it for F1 snapshots.
- Settings export and full backup include folder prefs as `{ path: string[], color?,
  hideFromSearch? }`; import maps a path to a folder only on an exact, unique title-path match
  and skips the rest (counted in the toast). Ids are never exported.

### F4. List view columns (row 3)

- Columns: **Added** (`dateAdded`), **Last opened**, **Rating**, **Visits**. A **Columns**
  menu in the list header turns each on or off (stored in sync storage, `listColumns`).
- **Last opened** = the latest of: `dateLastUsed` (opened from Chrome's bookmark UI),
  `meta.lastOpenedAt` (opened from this extension, written on click through
  `patchMetadata`), and the history `lastVisitTime` when the Visits permission is granted.
  Tooltip says which source it came from.
- **Rating**: 0 to 5 stars per bookmark URL in `meta_<url>.rating` (D0: keyed by bookmark URL),
  a radio group with keyboard support; clearing is "No rating". Included in full backups via
  the existing meta records.
- **Visits**: needs the optional `history` permission. Turning the column on calls
  `chrome.permissions.request({ permissions: ['history'] })` from the click (user gesture).
  Counts come from one `history.search({ text: '', startTime: 0, maxResults: 100000 })` per
  view load, mapped by URL [Inference: visitCount is per exact URL]. Declining leaves the
  column off with a toast explaining why. Turning it off offers to release the permission.
- Sort menu gains Last opened, Rating and Visits (Visits only when granted).
- 360px: columns collapse into one meta line under the title ("Added 3 Mar 2024 · Opened 2
  days ago · 4 stars · 12 visits"); desktop shows aligned columns with a header row.

### F5. Range multi-select with bulk actions (row 4)

- `useSelection(displayedNodes)` hook: `selected: Set<string>`, `anchor`, `toggle(id)`,
  `range(id)` (anchor to id in display order), `selectAll()`, `clear()`. Cleared on folder
  change, search change, and when selected nodes disappear.
- Each tile and row gets a checkbox (40px target). It is visible on hover and focus, and
  always visible once anything is selected or on narrow screens. Click toggles, Shift+click
  selects a range. Keyboard: Space on a focused tile toggles, Shift+Space selects a range,
  Ctrl/Cmd+A selects all in the view (not while typing), Escape clears.
- A selection bar replaces the tool row while items are selected: "N selected", **Open**,
  **Move to...**, **Delete**, **Select all**, **Clear**. Sticky at the bottom on phones (thumb
  zone), at the top of the content on desktop.
- **Delete** sends one `TRASH_DELETE` (one operation, one Undo).
- **Move to...** reuses the folder picker (generalised title and button text), moves in
  display order, and offers **Undo** in the toast: moves back to the recorded parent and index
  (page memory only; the page must stay open, said in the toast's tooltip). Scope rule from
  D7 applies: moving local bookmarks into a synced folder shows the destination's storage
  group in the picker, as Restore to... does.
- **Open** opens up to 20 in background tabs; more than 20 asks with an inline confirmation
  in the bar ("Open 47 tabs?" with Open and Cancel), not `confirm()`.

### F6. Per-folder colours (row 5)

- Eight named colours plus Default, each with light and dark tokens that meet 3:1 contrast
  against the surface as a graphic. Stored in folder prefs (F3).
- Context menu: **Colour...** opens a small dialog with a swatch radio group (labelled
  names, not colour alone) and Default.
- Applied in the sidebar, folder tiles, list rows, Trash rows and the folder picker.

## Data model changes

| Key | Area | Shape | Notes |
|---|---|---|---|
| `fpref_<folderId>` | local | `{ color?, hideFromSearch? }` | new; per folder |
| `trash_ext_op` | local | `{ operationId, lastAt, roots, dropped }` | new; written only by the Trash service |
| `trash_v1_*` | local | `origin` gains `'external'`; optional `folderPrefs: Record<oldId, FolderPref>`, optional `dropped` | additive; `version` stays 1 |
| `meta_<url>` | local | gains optional `rating` (1 to 5) and `lastOpenedAt` | additive; merged through `META_PATCH` |
| `listColumns`, `trashExternal` | sync | string array; boolean | added to `SETTINGS_SCHEMA` |

`storage_schema_version` does not change: every change is additive and the 1.2.1 migration
only touches verified legacy shapes (D1).

## Manifest

- `version` 1.4.0.
- `optional_permissions: ["history"]`. Permission gate: install warnings for 1.3.0 and 1.4.0
  must be identical (optional permissions are not shown at install) [to verify].

## Testing

- Unit: `recordExternal` (own delete ignored after a worker restart, grouping window, cap,
  permanent node, missing parent, setting off), folder prefs (per-key writes, prune, export and
  path-mapped import), selection hook (toggle, range, select all, clear on view change), list
  column derivations, search exclusion filter.
- Component: selection bar, column menu, colour dialog, rating input (keyboard).
- Real Chrome (isolated headless profile, then the owner's profile in background tabs):
  delete in `chrome://bookmarks` via the API from another context, check the Trash row and
  restore; bulk delete and Undo; bulk move and Undo; colours and hidden-from-search survive a
  delete and restore; optional permission request flow; 360px and desktop in both themes.

## Out of scope

| Item | Why |
|---|---|
| Undo for single rename and move (row 6) | Bulk move gets page-level Undo here; a persisted journal is its own release |
| Bookmark manager override (row 11) | Owner decision pending, policy check first |
| E2E harness in CI (row 7) | Candidate; decided in review |
| CSS token migration (row 8) | New CSS uses tokens; old CSS later |

---

# Autoplan review (2026-11-08)

Mode: SELECTIVE EXPANSION (feature iteration on an existing system). Codex available; Claude
subagent ran. The owner asked for 1.4.0 to be planned and built without check-ins, so every
intermediate question below was auto-decided; taste decisions and user challenges are listed
for the owner in the final report.

## Phase 1: CEO review

### 0A. Premise challenge

| Premise | Assessment |
|---|---|
| P1. The five rows are worth one release | Valid but thin: demand is one daily user's email. Both outside voices flag this. The owner explicitly asked for these items, so the direction stands (user challenge UC1). |
| P2. `onRemoved` capture can recover deletes made in Chrome's manager | Valid for deletes while Chrome runs (verified event shape). Not valid as "dependable recovery": events missed while the browser is closed, and sync removals of whole account trees, are not covered. The copy must promise only what it does. |
| P3. Folder prefs belong in local storage | Valid technically (ids are per device), but users will expect colours on every device. Fix: say "on this device" in the UI and carry prefs in exports by path. |
| P4. Rating and Visits are wanted | Asked for by the user (email item 7). Kept, but Visits stays opt-in behind an optional permission and costs nothing until turned on. |
| P5. 1.3.0 can be built upon before it ships | Risky: no field feedback yet (both voices). Building on a branch is cheap; shipping order is the owner's call (ROADMAP row 9). |

### 0B. What already exists (leverage map)

| Sub-problem | Existing code |
|---|---|
| Snapshot, restore, scope rules for external deletes | `src/sw/trash.ts` (`toSavedNode`, `resolveParent`, `createSubtree`, queue, reconcile) |
| Ancestor walk, permanent root, managed checks | `src/lib/bookmark_tree.ts` |
| Folder picker for Move to... | `src/components/FolderPicker.tsx` (Restore to...) |
| Delete of many ids as one Undo | `TRASH_DELETE` with an id list (Duplicate Finder already sends many) |
| Per-URL metadata writes (rating, lastOpenedAt) | `META_PATCH` / `patchMetadata` (`src/lib/metadata_client.ts`) |
| Settings allowlist, export and import | `SETTINGS_SCHEMA` in `src/lib/backup_manager.ts` |
| Tree refresh on bookmark events | `useBookmarkTree` (150 ms coalescing) |
| Toast with Undo and Ctrl+Z | `useToast`, `Toast.tsx` |
| Folder glyph | `FolderGlyph` in `BookmarkPreview.tsx` |

### 0C. Dream state

```
CURRENT (1.3.0)                     THIS PLAN (1.4.0)                       12-MONTH IDEAL
Undo for deletes made here    --->  + deletes made in Chrome / sync    --->  A safety net: every change
Search covers every folder          + hidden folders, colours                to bookmarks is recoverable
One item at a time                  + range select, bulk delete/move         (delete, move, rename), with
List: title and URL only            + Added, Last opened, Rating, Visits     a "what changed" timeline,
                                                                             organisation that follows
                                                                             the user across devices
```

Delta left after this plan: rename and move history (row 6), recovery of changes made while
the browser was closed (snapshot diffing), and cross-device prefs.

### 0C-bis. Implementation alternatives

```
APPROACH A: All five as specified (event capture, local prefs, page-level bulk-move Undo)
  Effort: L   Risk: Med
  Pros: answers the whole user request in one update; shared prefs store; one permission gate
  Cons: largest regression surface; one-user demand
  Reuses: Trash service, FolderPicker, META_PATCH, SETTINGS_SCHEMA

APPROACH B (minimal viable): 1.4.0 = bulk select + hide from search + colours; F1 later
  Effort: M   Risk: Low
  Pros: low risk; no Trash changes
  Cons: the main recovery gap stays; two Web Store reviews for one request list

APPROACH C (ideal architecture): versioned tree snapshots on the daily alarm, diffed
  Effort: XL  Risk: Med
  Pros: recovers changes missed while the worker slept; timeline; makes row 6 nearly free
  Cons: storage grows with tree size times retention; new restore semantics; not what was asked
```

**RECOMMENDATION: A, with the CEO fixes below folded in**, because the owner asked for these
items, the risky part (F1) reuses a tested service, and the fixes remove the data-loss and
privacy gaps both voices found. C is recorded as the next step for the safety-net direction.

### 0D. Selective expansion scan

Complexity: the plan touches about 20 files and adds 3 modules (`folder_prefs`, `useSelection`,
list column helpers). Accepted because each feature is independent and gets its own tests.

| Candidate | Effort | Decision |
|---|---|---|
| Trash toggle for "keep items deleted elsewhere" shown in the Trash view, not buried in a menu | S | **Accepted** (privacy transparency, both voices) |
| "Deleted in Chrome" source label and filter chip in Trash | S | **Accepted** (in blast radius) |
| Snapshot-based safety net (approach C) | XL | Deferred to ROADMAP |
| Persisted Undo for single rename and move (row 6) | M | Deferred (row 6 stays open) |
| E2E harness in CI (row 7) | M | **Accepted, reduced**: commit the CDP smoke script as `npm run e2e` (local, headless, isolated profile); CI wiring deferred because it needs a Chrome with extension debugging in CI |
| Migrate old CSS to tokens (row 8) | S to M | Deferred; new CSS uses tokens |

### 0E. Temporal interrogation

- Hour 1: user opens 1.4.0. Nothing looks different until they select, right-click a folder or
  open list view. Trash shows the new toggle text once.
- Hour 6+: a sync from another device removes 300 bookmarks; Trash gains one row "300 items,
  deleted outside this extension"; Restore puts them back and sync spreads them again (by
  design; the row text says so).
- Day 30: external entries expire like any other. Folder prefs for deleted folders are pruned.

### CEO dual voices

**CODEX SAYS (CEO, strategy challenge):** one user's list is not a strategy; 1.3.0 has no field
feedback; alternatives were packaging choices; the 200-root cap discards data in the very
incident that matters; default-on retention changes the privacy contract; rating and visits are
columns, not retrieval; local prefs and memory-only bulk Undo create inconsistencies.

**CLAUDE SUBAGENT (CEO, strategic independence):** 1.3.0 unshipped (critical); the cap is
backwards (critical); sign-out capture can copy another person's synced tree into local Trash
(critical); snapshots are the 10x reframe (high); restoring after a sync wipe re-spreads by sync
(high); one-user demand for Rating and Visits (high); shared plumbing overstated, split the
release (high); colours will not sync (medium); memory-only Undo contradicts D8 (medium);
parity items are table stakes (medium); 2 s grouping window unmeasured (medium).

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   partly  partly CONFIRMED (thin demand)
  2. Right problem to solve?           partly  partly CONFIRMED (safety net is the bigger bet)
  3. Scope calibration correct?        no      no     CONFIRMED -> user challenge UC1
  4. Alternatives sufficiently explored?no     no     CONFIRMED -> approach C added
  5. Competitive/market risks covered? no      no     CONFIRMED (parity is table stakes)
  6. 6-month trajectory sound?         partly  partly CONFIRMED (cross-device prefs, row 6)
═══════════════════════════════════════════════════════════════
```

### CEO fixes folded into the plan (auto-decided)

1. **No root cap.** A burst is one operation with one entry per removed root, however many.
   `unlimitedStorage` is granted, and a 5,000-bookmark wipe is about 1 to 2 MB of JSON. A
   sanity limit of 50,000 nodes per operation logs and stops recording beyond it (never hit in
   practice; protects against a runaway loop).
2. **Sliding 3-second grouping window** (`lastAt` moves with each event), so a slow sync burst
   stays one row.
3. **Never capture a disappearing account tree.** Skip when the removed node is permanent,
   when its parent no longer exists at processing time, or when the parent's permanent root is
   gone. These are the sign-out shapes. Real sign-out was not tested (no test account); the
   Trash toggle and the copy cover the rest.
4. **Transparency.** The Trash view shows "Also keep bookmarks deleted in Chrome or on your
   other devices" as a switch with one line of explanation; PRIVACY.md says what is kept, for
   how long, and how to remove it (Empty Trash). Default on (the user asked for recovery).
5. **"Last opened" is honest**: the tooltip names the source; the column header is "Last
   opened"; without history permission it shows opens from this extension and from Chrome's
   bookmark UI only, and says so in the Columns menu.
6. **Colours and hidden folders say "on this device"** in their dialog/menu; exports carry
   them by folder path so a backup moves them to another machine.
7. **Bulk move Undo lives as long as its toast** (like delete before Trash existed). The toast
   says "Moved N items"; no promise beyond it.

### Sections 1 to 11 (CEO)

**1. Architecture.**

```
 extension page (React)                               service worker
 ┌──────────────────────────────┐   TRASH_DELETE     ┌──────────────────────────────────┐
 │ useSelection ─▶ SelectionBar ├──────────────────▶ │ trash.ts queue                   │
 │ MainContent / Sidebar        │   TRASH_RESTORE    │  deleteNow / restoreNow          │
 │  ├ folder colour, hidden icon│ ◀──TRASH_CHANGED── │  recordExternal  ◀── onRemoved ──┼── Chrome (manager, sync)
 │ ListColumns (added, opened,  │                    │  reconcile / purge (alarm)       │
 │   rating, visits)            │   META_PATCH       │ storage_index (meta_<url>)       │
 │ useFolderPrefs ──────────────┼─▶ fpref_<id> (local, page writes, per key)            │
 │ chrome.history (optional)    │                    │  read by trash.ts for snapshots  │
 └──────────────────────────────┘                    └──────────────────────────────────┘
```

New coupling: `trash.ts` reads `fpref_*` to snapshot folder prefs; justified (one read per
delete, DOM-free module). Rollback: ship a 1.4.1 that drops the listener; external entries are
ordinary Trash entries and stay restorable. No new state machine; external entries reuse the
1.3.0 one (they start at `deleted`).

**2. Error and rescue map.**

| Codepath | What can go wrong | Rescued? | Action | User sees |
|---|---|---|---|---|
| recordExternal | `removeInfo.node` absent | Y | skip, log `[Trash] external: no node` | nothing |
| recordExternal | storage write fails (quota, IO) | Y | log with id and title count | nothing (best effort, as in the 1.3.0 design) |
| recordExternal | parent gone / permanent node | Y | skip, log reason | nothing |
| folder prefs write | storage write fails | Y | toast "Couldn't save the colour. Try again." | toast |
| history.search | permission revoked meanwhile | Y | column shows "Turn on" and the menu explains | inline |
| permissions.request | user declines | Y | column stays off | toast with reason |
| bulk move | one move fails (managed, removed) | Y | continue others, toast "Moved 18 of 20. 2 couldn't be moved." | toast |
| bulk move Undo | node gone or parent gone | Y | skip those, report count | toast |
| bulk open | > 20 tabs | Y | inline confirm in the bar | inline |

**3. Security.** New inputs: folder prefs (page-written, local), rating (1 to 5 integer, clamped
in `META_PATCH` sanitising), imported prefs (validated like settings: colour in the fixed list,
path array of strings up to 64 items of 1,000 chars). `history` data never leaves the page and is
not stored. `onRemoved` capture only stores what Chrome already held locally. No new message
types reachable from content scripts (external capture is an internal listener). Threat: a
crafted backup with a huge `folderPrefs` array; mitigated by caps (2,000 items).

**4. Data flow and interaction edge cases.**

| Interaction | Edge case | Handled |
|---|---|---|
| Select | items deleted elsewhere while selected | selection pruned on tree refresh |
| Select | 5,000 items, Select all | Set of ids, bar shows count; delete is one message (limit 10,000 exists) |
| Bulk delete | double click Delete | button disabled while pending |
| Bulk move | target is inside a selected folder | picker excludes selected folders and their descendants |
| Bulk move | permanent or managed items selected | skipped with count |
| Columns | Visits on, permission revoked in chrome://extensions | detected on load, column shows Turn on |
| External capture | user deletes in Chrome's manager while this extension's restore runs | queued behind the restore |
| External capture | extension delete then same id event after worker restart | entry lookup by `tree.oldId` |
| Hide from search | excluded folder deleted | pref pruned; restore re-applies from the entry |

**5. Code quality.** Folder prefs logic in one module; selection in one hook; columns in one
helper; no duplicated ancestor walks (reuse a parent map built once per tree revision).

**6. Tests.** See the test diagram in Phase 3.

**7. Performance.** Search filter: O(results x depth) over an in-memory parent map. History
scan: one call per view load when Visits is on (about 100 ms on 100k history items
[Unverified]). Selection: Set operations. External capture: one getNode per event plus one
trash index read (cached in memory per revision).

**8. Observability.** `[Trash] external` log lines with operation id, roots and nodes; skip
reasons logged once per burst. Trash rows show the source.

**9. Deployment.** Optional permission does not change install warnings [to verify with the
permission gate]. No migration. Rollback: 1.4.1 removing the listener.

**10. Long-term.** Reversibility 4/5 (additive keys, optional permission). Path dependency:
local folder prefs; mitigated by path-based export. Next: snapshot safety net (approach C),
persisted move/rename Undo.

**11. Design and UX.** Covered in Phase 2.

### NOT in scope (1.4.0)

| Item | Why |
|---|---|
| Snapshot-based recovery of changes made while the browser was closed | XL, new semantics; next safety-net step |
| Persisted Undo for single rename and move (row 6) | Separate journal work |
| Cross-device folder prefs | Bookmark ids differ per device; path-based export covers moving machines |
| E2E in CI | Needs CI Chrome with extension debugging; local `npm run e2e` first |
| CSS token migration (row 8) | Low impact |
| Bookmark manager override (row 11) | Owner decision |

### Failure modes registry

| Failure | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Own delete recorded twice as external | Med without the lookup | Duplicate rows | Lookup by `tree.oldId` inside the queue |
| Sign-out copies an account tree into Trash | Low [Unverified] | Privacy | Skip shapes listed in fix 3; switch in Trash view |
| Restore after sync wipe re-spreads | Expected | Intended | Row text |
| History scan slow on huge history | Low | Laggy list | Only when Visits is on; async, list renders first |
| Prefs lost on delete then restore | Med | Annoyance | Snapshot prefs into the entry |

### CEO completion summary

| Item | Result |
|---|---|
| Mode | SELECTIVE EXPANSION |
| Premises | 5 assessed; 1 user challenge (UC1: split or defer the release) |
| Approach | A with 7 fixes |
| Expansions accepted | 3 (Trash switch, source label, local `npm run e2e`) |
| Deferred | 4 |
| Critical gaps left | 0 (sign-out untested, mitigated) |

## Phase 2: Design review

### Step 0. Scope

Initial completeness: 5/10. The plan named mechanisms (columns, checkboxes, swatches) but not
screens, states or the touch path. No DESIGN.md; the design vocabulary is the token set in
`src/popup/index.css` (1.3.0) plus `shared.css` (buttons, modal, picker, toast). New UI reuses
`Modal`, `FolderPicker`, `Toast`, `btn` classes and `FolderGlyph`.

### Dual voices

**CODEX SAYS (design critique):** demand thin, keep columns opt-in; external capture needs a
visible contract in Trash including empty state and what turning it off does; "Last opened"
mixes two meanings, split it; move Undo dies with an 8 s toast that a new toast replaces; many
loading/error/partial states missing (history, prefs save, revoked permission, partial bulk,
"all matches hidden"); six actions do not fit at 360 px, bar/toast overlap; checkbox labels,
announcements, focus after actions; "Space on a tile" collides with links; show "on this
device" on both prefs; define inherited exclusion and invalid move targets.

**CLAUDE SUBAGENT (design completeness):** hierarchy undefined for a 360 px row; always-visible
checkboxes on phones are noise, use a Select button; missing states for external Trash
entries, empty "Opened", history loading, revoked permission, partial bulk, all-hidden search;
memory-only Undo is hidden behind a hover tooltip; history permission asked with no
pre-prompt; hide-from-search reachable by right-click only; colours unspecified; selection bar
collisions; focus destinations; 5 stars at 40 px do not fit a meta line; rating shared per URL
must be said.

```
DESIGN OUTSIDE VOICES — LITMUS SCORECARD:
═══════════════════════════════════════════════════════════════
  Check                                    Claude  Codex  Consensus
  ─────────────────────────────────────── ─────── ─────── ─────────
  1. Brand unmistakable in first screen?   n/a     n/a    NOT SPEC'D (existing app chrome)
  2. One strong visual anchor?             no      no     CONFIRMED gap (selection bar, Trash)
  3. Scannable by headlines only?          no      partly CONFIRMED gap (row hierarchy)
  4. Each section has one job?             partly  partly CONFIRMED (bar overloaded)
  5. Cards actually necessary?             yes     yes    CONFIRMED (existing tiles)
  6. Motion improves hierarchy?            n/a     n/a    NOT SPEC'D (no new motion)
  7. Premium without decorative shadows?   yes     yes    CONFIRMED (token surfaces)
  ─────────────────────────────────────── ─────── ─────── ─────────
  Hard rejections triggered:               0       0      none
═══════════════════════════════════════════════════════════════
```

### Pass 1. Information architecture (4 -> 9)

```
DESKTOP (>= 720 px), bookmarks panel
┌ top bar: [Folders] Bookmarks [search........] [AI] [Preview ▶■] [Filter] [Sort] [Select] [▦|☰] [◐][⚙] ┐
├ header: ← Folder title                         (list view only: [Columns ▾])                       ┤
│   selection mode replaces the header row:                                                           │
│   [☐ 3 selected]  [Open] [Move to…] [Delete]           [Select all] [Done]                         │
├ content: tiles / rows, checkbox top-left on hover, focus, or in selection mode                     ┤
└ toast (bottom centre)                                                                               ┘

PHONE (360 px)
┌ [Folders] Bookmarks            [◐][⚙] ┐
│ [search...........................]  │
│ [AI][▶■][Filter][Sort][Select][▦|☰]  │   Select is a labelled-icon button (40 px)
├──────────────────────────────────────┤
│ row: ☐ (selection mode only)          │
│      Title (one line, ellipsis)       │
│      domain · Added 3 Mar 2024 · ★4   │   one meta line, wraps at most to two lines
├──────────────────────────────────────┤
│ selection bar, sticky bottom, safe-area padded:                     │
│ [3 selected]   [Move to…] [Delete] [⋯]   (⋯ = Open, Select all, Done) │
└──────────────────────────────────────┘   toast sits above the bar
```

Row hierarchy: title, then the folder cue (colour, hidden-from-search icon), then one meta line.
Rating and Visits never push the title off a phone row.

### Pass 2. Interaction states (3 -> 9)

```
FEATURE              | LOADING                | EMPTY                          | ERROR                               | SUCCESS                       | PARTIAL
---------------------|------------------------|--------------------------------|-------------------------------------|-------------------------------|------------------------------
Trash, external rows | existing skeleton      | "Nothing in Trash. Bookmarks   | existing Retry                      | row: "Deleted outside this    | n/a (no cap)
                     |                        | deleted here, in Chrome or on  |                                     | extension · 3 items"          |
                     |                        | your other devices appear here"|                                     |                               |
Trash switch         | disabled while saving  | n/a                            | toast "Couldn't save. Try again."   | switch moves; line explains   | n/a
Search exclusion     | existing               | "No matches"                   | n/a                                 | "4 more in hidden folders ·   | "All 4 matches are in hidden
                     |                        |                                |                                     | Show them" under the header   | folders · Show them"
Columns: history     | cells show "…"         | "—" (aria "Not visited")       | "—" + menu note "Couldn't read      | numbers / dates               | n/a
                     |                        |                                | history"                            |                               |
History permission   | menu button busy       | n/a                            | declined: inline "Chrome didn't     | columns appear                | revoked later: columns hidden,
                     |                        |                                | allow it. Allow to try again."      |                               | menu offers Allow again
Opened column        | n/a                    | "—" (aria "Not opened yet")    | n/a                                 | "2 days ago" (title = date)   | n/a
Rating               | n/a                    | "Rate" text button             | toast "Couldn't save the rating"    | stars + "4 of 5"              | n/a
Bulk delete          | Delete button spinner  | n/a                            | toast with reason, selection kept   | existing Undo toast           | "Deleted 18. 2 couldn't be
                     |                        |                                |                                     |                               | deleted" (kept selected)
Bulk move            | Move button spinner    | picker: "No folder matches"    | toast with reason, selection kept   | "Moved 5 items to Recipes"    | "Moved 17 of 20. 3 couldn't
                     |                        |                                |                                     | + Undo                        | be moved" + Undo for the 17
Bulk open            | n/a                    | n/a                            | n/a                                 | tabs open in background       | > 20: inline "Open 47 tabs?"
Folder colour/hide   | dialog button busy     | n/a                            | toast "Couldn't save. Try again."   | swatch checked; icon updates  | n/a
```

### Pass 3. User journey (5 -> 8)

| Step | User does | Feels | Plan specifies |
|---|---|---|---|
| 1 | Deletes a folder in Chrome's manager by mistake | Panic | Trash already has it; row says "Deleted outside this extension" |
| 2 | Opens Trash, sees the switch explained | Relief, trust | Switch with one-line explanation at the top of Trash |
| 3 | Selects 12 old links with Select, Shift+click | In control | Selection mode, count, bar |
| 4 | Moves them, realises wrong folder | Doubt | Undo in the toast; toast pauses on hover and when the tab is hidden |
| 5 | Turns on Visits | Cautious | Pre-prompt line before Chrome's dialog, "stays on this device" |
| 6 | Colours a folder red | Ownership | Named swatches, "Colours are saved on this device" |

### Pass 4. AI slop risk (6 -> 8)

Specifics now named: colour names and tokens (below), the Trash switch copy, empty and partial
strings, bar layout per width. No hard rejections (no hero, no 3-column marketing grid, no
decorative gradients). Litmus answers support Pass 1 and 2 findings.

### Pass 5. Design system alignment (6 -> 8)

No DESIGN.md (recommend `/design-consultation` later; recorded, not blocking). New CSS uses the
1.3.0 tokens (`--color-surface*`, `--color-text*`, `--color-accent*`, `--color-danger`,
`--color-focus`). Folder colours become tokens:

| Name | Light | Dark |
|---|---|---|
| Yellow (default) | existing folder tokens | existing |
| Orange | #E8710A | #FCAD70 |
| Red | #D93025 | #F28B82 |
| Pink | #D01884 | #FF8BCB |
| Purple | #9334E6 | #D7AEFB |
| Blue | #1A73E8 | #8AB4F8 |
| Teal | #12A4AF | #78D9EC |
| Green | #188038 | #81C995 |
| Grey | #5F6368 | #BDC1C6 |

All meet 3:1 against `--color-surface` as graphics in their theme [to verify in QA].

### Pass 6. Responsive and accessibility (5 -> 9)

- Every new control is at least 40 px tall on narrow widths and with coarse pointers.
- Checkbox: a real `<input type="checkbox">` with `aria-label="Select <title>"`; Space toggles
  natively; Shift+Space or Shift+click selects the range from the anchor. No Space handling on
  the tile itself (links keep Enter).
- Ctrl/Cmd+A selects everything in the view (the view is not virtualised) when focus is not in
  a text field. Escape leaves selection mode. The count is announced through the existing
  polite live region ("3 selected").
- Focus: after bulk delete, the first item after the deleted block; after the colour or rating
  dialog, the control that opened it; when the bar closes, the Select button.
- Rating: a "Rate" button opens a small dialog with a 5-option radio group (40 px each, star
  plus number) and "No rating"; the row shows read-only stars with text "4 of 5". Same pattern
  at every width.
- Colour dialog: radio group of named swatches (40 px, name under each, a check mark on the
  selected one, not colour alone).
- Touch path for folder actions: the existing "More actions" button on every tile and row
  (not right-click only) holds Colour..., Hide from search / Show in search.
- Hidden-from-search icon appears in the sidebar, folder tiles and list rows, with
  `aria-label="Hidden from search"`.

### Pass 7. Decisions register (auto-decided)

| Decision | Choice |
|---|---|
| Selection entry | Select button (labelled) plus hover/focus checkbox on desktop; no long-press |
| Phone bar | Move to..., Delete, overflow (Open, Select all, Done) |
| "Last opened" | Split: **Opened** (from this extension or Chrome's bookmark UI) and **Last visited** (history, opt-in); never mixed |
| Default columns | Added, Opened, Rating on; Visits and Last visited off |
| Missing values | "—" with an aria label; sort places them last |
| Middle-click and bulk Open | Count as Opened |
| Rating scope | Per link (URL), said in the dialog: "Applies to every bookmark of this link" |
| Inherited exclusion | A hidden folder hides its subfolders; only the folder itself shows the icon; its subfolders' tooltips say "Hidden with <parent>" |
| Invalid move targets | Picker hides selected folders and their descendants, managed folders, the root |
| Bulk Open of folders | Opens bookmarks directly inside selected folders (one level), counted in the confirm |
| Trash switch off | Stops new captures; existing entries stay |
| Move Undo window | The toast's life (8 s, paused on hover, focus and hidden tab); text "Undo" only, no extra promise |

### Design completion summary

| Pass | Before | After |
|---|---|---|
| Information architecture | 4 | 9 |
| Interaction states | 3 | 9 |
| User journey | 5 | 8 |
| AI slop | 6 | 8 |
| Design system | 6 | 8 |
| Responsive and accessibility | 5 | 9 |
| Decisions resolved | 0 of 12 | 12 of 12 |

## Phase 3: Eng review

### Step 0. Scope challenge (code read)

Read: `src/sw/trash.ts` (queue, `reconcileNow` before every task, `deleteNow`, `restoreOne`,
`restoreNow` ordering), `src/lib/trash_store.ts`, `src/lib/bookmark_tree.ts` (`createSubtree`
with `onNode`), `src/sw.ts` (`META_PATCH` spreads `update` unchecked), `src/lib/metadata_client.ts`,
`src/lib/backup_manager.ts` (metadata exported only next to thumbnails), `useBookmarkTree`
(tree, folder and search load in separate effects), `App.tsx` (`displayedNodes` rebuilt per
render), `MainContent.tsx`, `AISettingsPage.tsx` (Smart Search flattens to title/URL, dedupes,
caps). Complexity: about 22 files, 4 new modules. Not reduced (P2): each feature is independent.

### Dual voices

**CODEX SAYS (eng, architecture challenge):** queued processing loses a child deleted before
its parent (context must be captured at event time); one `fpref_` object per folder still
loses concurrent field writes and has no change signal; page-side pruning races capture;
bulk move must normalise roots and snapshot original positions before moving; ratings and tags
are not in backups unless a preview exists; uncapped bursts mean quadratic reconcile work;
sequential external deletes report index 0 twice, so restore order must follow event order;
Smart Search loses ids before the cap; history absence is not "not visited" with a finite
scan; Opened needs every open path and a cross-tab update.

**CLAUDE SUBAGENT (eng, independent review):** every `onRemoved` does a full Trash read
(critical); the plan contradicts itself (2 s vs 3 s, cap vs no cap, orphan kept vs skipped,
merged vs split Last opened); child-first sync deletes become empty folders (critical); external
entries need `ancestors`; a sliding window can grow for hours; prefs prune race; two writers for
prefs and no change signal; `META_PATCH` accepts any fields (high); cross-device double restore
duplicates bookmarks; history permission gesture, revocation and cost; Shift ranges after
re-sort or anchor deletion; bulk move flattens nested selections and undoes in the wrong order;
search exclusion fails open while the tree is stale; missing 2am tests.

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               no      no     CONFIRMED -> final spec rewrites F1, F3
  2. Test coverage sufficient?         no      no     CONFIRMED -> test plan below
  3. Performance risks addressed?      no      no     CONFIRMED -> batched flush
  4. Security threats covered?         no      partly CONFIRMED -> META_PATCH allowlist
  5. Error paths handled?              partly  partly CONFIRMED -> state table + partial moves
  6. Deployment risk manageable?       yes     yes    CONFIRMED (additive, optional permission)
═══════════════════════════════════════════════════════════════
```

### Section 1. Architecture (final)

```
 Chrome bookmarks ──onRemoved──▶ sw.ts ──▶ trash.noteRemoved(id, info)   (sync: no await)
                                              │ starts getAncestors(parent) immediately
                                              ▼ in-memory buffer (seq, info, ctx promise)
                                         3 s quiet timer / 60 s / 5,000 roots
                                              ▼ enqueue(flushExternal)  (one reconcile)
                                   nest child-first events, drop own deletes
                                   (selfRemoved set + persisted root ids), read fpref_*,
                                   one storage.set, one TRASH_CHANGED
 page ──FOLDER_PREFS_SET──▶ sw/folder_prefs.ts (single writer of fpref_*) ──FOLDER_PREFS_CHANGED──▶ pages
 page ──META_PATCH (allowlisted fields)──▶ storageIndex.patch ──META_UPDATED {urls}──▶ pages
 page: useSelection, SelectionBar, bulk move (page, journaled in memory), ListColumns,
       useHistoryStats (optional permission, getVisits per displayed URL, session cache)
 trash.restoreOne ──onNode──▶ folder_prefs.applySnapshot(oldId -> newId)
```

### Section 2. Code quality decisions

- One ancestor helper (`getAncestors`) for delete, external capture and the search filter's
  fallback; no second walker.
- The search filter lives in `useBookmarkTree`'s search effect, which reads the tree in the same
  revision (no stale parent map).
- `META_PATCH` gets a field allowlist shared with backup import (`sanitizeMetaPatch`).

### Section 3. Test diagram

```
NEW FLOW / CODEPATH                         TEST TYPE   COVERED BY (new unless noted)
External capture: single bookmark           unit        trash_external.test: records entry with ancestors, scope, index
External capture: removeTree folder         unit        same: one entry, subtree, folder prefs snapshotted
Own delete not recorded (in-memory set)     unit        same: deleteNow then event -> no external entry
Own delete after worker restart             unit        same: fresh service, persisted root id match -> skipped
Child-first burst                           unit        same: child then parent -> one entry, child nested
Parent gone, not in burst (sign-out shape)  unit        same: skipped, logged
Permanent node removed                      unit        same: skipped
Setting off                                 unit        same: nothing recorded
Burst split at 60 s / 5,000 roots           unit        same (fake clock)
Restore external ops in reverse event order unit        same: [A,B,C] delete A then B -> restore -> [A,B,C]
External restore: identical bookmark exists unit        same: reused, not duplicated
10,000-id own delete                        unit        same: no external entries; one flush
Folder prefs set/clear/merge, validation    unit        folder_prefs.test
Prefs prune (SW only, not in Trash)         unit        folder_prefs.test
Prefs carried through delete and restore    unit        trash_restore.test (extended)
META_PATCH allowlist (rating, lastOpenedAt) unit        metadata_sanitize.test
Backup: metadata section round trip         unit        backup_manager.test (extended), hostile input
Backup/settings: folder prefs by path       unit        backup_manager.test (extended)
Search exclusion + hidden count + Show them unit/hook   useBookmarkTree.test (extended)
Smart Search exclusion before cap           unit        ai search candidate filter test
Selection: toggle, range, anchor gone,      hook        useSelection.test
  clear on view change, select all
Bulk move normalise, partial, Undo order    unit        bulk_move.test
History stats: permission off/on/revoked    hook        useHistoryStats.test
List columns derivation, missing values     unit        list_columns.test
Selection bar, Columns menu, colour dialog, component   SelectionBar/ListColumns/FolderColorDialog/RatingDialog tests
  rating dialog keyboard
App flows: select + bulk delete + Undo      component   App.test (extended)
Real Chrome: external delete in another     e2e         scripts/e2e/smoke.mjs (npm run e2e), owner profile QA
  context, restore; optional permission gate
```

Test plan artifact written to `~/.gstack/projects/PalWorks-Bookmark-Preview-as-Thumbnails/`.

### Section 4. Performance

- External capture: O(events) per flush plus one Trash read; no per-event reconcile.
- Search filter: parent map from one `getTree()` per search revision (800 nodes: about 1 ms).
- History: `getVisits` only for displayed URLs, 8 at a time, cached per page session.
- Selection: Set of ids; range over the displayed array.

### Failure modes registry (eng)

| Failure | Critical gap? | Handling |
|---|---|---|
| Worker dies with buffered external events | Accepted gap (logged as known) | Chrome keeps the worker alive 30 s after an event; the buffer flushes at 3 s |
| Own delete misread as external | No | in-memory set + persisted root ids |
| Child-first sync burst | No | nesting inside the burst |
| Prefs lost before snapshot | No | only the worker prunes, in the daily alarm |
| Hostile backup metadata | No | shared sanitiser, caps |
| Bulk move interrupted by tab close | Accepted gap | documented; no partial-state journal |
| History permission revoked | No | `permissions.onRemoved` hides the columns |

## Final build spec (authoritative)

### F1. External deletions

1. `trash.noteRemoved(id, info)` is called synchronously from the `onRemoved` listener (regular
   worker only). It records `{ seq, at, id, info, ctx }` where `ctx` is a promise started at
   once: `getNode(info.parentId)` then `getAncestors` and the permanent root. Nothing awaits in
   the listener.
2. A flush is scheduled 3 s after the last event, or at once when the buffer reaches 5,000 roots
   or its first event is 60 s old. The flush runs through `enqueue` (one reconcile per flush).
3. Flush steps: drop events whose id is in `selfRemoved` (ids `deleteNow` is removing, kept
   60 s) or matches a root id of any persisted Trash entry; drop permanent nodes; nest an event
   inside another event's saved tree when its `parentId` is a node of that tree (child-first
   order); for each remaining top root, if `ctx` failed (parent gone at event time) skip it
   (sign-out shape), else build the entry like `deleteNow` (ancestors, scope, `parentId`,
   `index` from `info`), plus `seq` and `folderPrefs` (read from `fpref_*` for every folder in
   the tree). Skip everything when `trashExternal` (sync) is false.
4. One `storage.local.set` with every entry (state `deleted`, origin `external`), one
   `TRASH_CHANGED`. Log `[Trash] external` with operation id, roots, nodes, skipped counts.
5. Restore: entries of an operation restore in ascending `index` for extension deletes (as
   now) and in descending `seq` for external ones. For external bookmark roots, an identical
   child (same title and URL) already under the target counts as restored ("already present").
6. No `trash_ext_op` key, no cap beyond the 5,000-root split.

### F2. Hidden from search

- `hideFromSearch` in folder prefs. The search effect in `useBookmarkTree` reads the tree in the
  same revision, builds a parent map, and returns `searchResults` (visible) plus `hiddenCount`;
  `includeHidden` (reset when the query changes) shows them.
- Smart Search: candidate list filtered by ancestor exclusion before de-duplication and the cap.

### F3. Folder prefs

- Keys `fpref_<folderId> = { color?: FolderColor; hideFromSearch?: true }`, written only by the
  worker (`src/sw/folder_prefs.ts`, own promise queue). Message `FOLDER_PREFS_SET { ids,
  patch: { color?: FolderColor | null, hideFromSearch?: boolean } }` from extension pages only;
  validates ids are existing, non-root folders; broadcasts `FOLDER_PREFS_CHANGED`.
- Pages read all `fpref_*` once (getKeys prefix, `get(null)` fallback) and on that broadcast and
  on `TRASH_CHANGED`.
- Pruning: daily alarm only, for folders that no longer exist (Trash entries hold their own
  copy).
- Trash: `deleteNow` and the external flush snapshot prefs for folders in the tree;
  `restoreOne` writes them to the new ids through `onNode`.
- Export: settings export and full backup carry `folderPrefs: [{ path, color?, hideFromSearch? }]`;
  import maps exact unique title paths and sends one `FOLDER_PREFS_SET` per folder; skipped
  count in the toast. Caps: 2,000 items, path up to 64 strings of up to 1,000 chars.

### F4. List columns

- Columns: Added (`dateAdded`), Opened (latest of `dateLastUsed` and `meta.lastOpenedAt`),
  Rating (`meta.rating`), Visits and Last visited (history, optional permission). Defaults:
  Added, Opened, Rating. Stored in sync `listColumns`.
- `lastOpenedAt` written on click and middle-click of a bookmark link, context menu opens, and
  bulk Open; `META_PATCH` broadcasts `META_UPDATED { urls }`.
- `META_PATCH` allowlist: `rating` (integer 1 to 5, or `null` to clear), `lastOpenedAt` (number,
  not in the future), `tags` (existing), `status`/`title`/thumbnail fields only from the worker's
  own capture path (not from pages). `id` at most 2,048 characters.
- Full backup gains `metadata: [{ url, rating?, lastOpenedAt?, tags? }]` for every meta record;
  import applies through the same sanitiser: rating and tags only where the local record has
  none, `lastOpenedAt` as the later value.
- History: `permissions.request` is the first call in the click handler; `permissions.contains`
  on load; `permissions.onAdded/onRemoved` update the state. Data from `history.getVisits` for
  displayed URLs, 8 at a time, cached per session. Tooltip: "From Chrome's history on this
  device (Chrome keeps about 90 days). Counts this exact link."
- Sort menu adds Opened, Rating, Visits (when allowed). Missing values sort last.

### F5. Selection and bulk actions

- `useSelection`: ids only; anchor id; range computed from the current displayed order at click
  time; anchor missing means toggle; cleared on folder, search, filter or sort change, and pruned
  when ids disappear.
- Bulk delete: one `TRASH_DELETE` (roots normalised by the worker as now).
- Bulk move (page): normalise roots (drop items inside another selected folder), skip permanent
  and managed, snapshot `{ id, parentId, index }` for all before moving, move in display order,
  report partial results; Undo moves back per parent in ascending original index, skipping and
  counting nodes that are gone or whose parent is gone.
- Bulk open: bookmarks selected plus bookmarks directly inside selected folders; above 20, an
  inline confirmation in the bar.

### F6. Colours

- Nine choices (Default yellow plus the eight in the Pass 5 table) as CSS tokens; `FolderGlyph`
  takes a colour name; applied in the sidebar, folder tiles, list rows, Trash rows and the picker.

### Release

- `version` 1.4.0; `optional_permissions: ["history"]`; permission gate before release.
- `npm run e2e`: the local headless smoke script, committed under `scripts/e2e/`.

## Decision audit trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | CEO | Mode SELECTIVE EXPANSION | Mechanical | context default | Iteration on an existing system |
| 2 | CEO | Approach A (all five) with fixes | User challenge UC1 | owner direction | Both voices prefer splitting; the owner asked for 1.4.0 to implement the plans, so the direction stands and UC1 goes to the owner |
| 3 | CEO | Remove the 200-root cap | Mechanical | P1 | The cap dropped data in the incident that matters |
| 4 | CEO | Skip sign-out shapes | Mechanical | P1 | Privacy; parent gone at event time |
| 5 | CEO | Trash switch in the Trash view, default on | Taste | P1 | Transparency; default on because the user asked for recovery |
| 6 | CEO | Local `npm run e2e`, CI deferred | Taste | P3 | CI Chrome with extension debugging is new infra |
| 7 | CEO | Snapshot safety net deferred | Mechanical | P3 | XL, outside the blast radius |
| 8 | Design | Select button mode, no always-on phone checkboxes | Mechanical | P5 | Less noise, no gesture-only entry |
| 9 | Design | Split Opened and Last visited | Mechanical | P5 | One meaning per column |
| 10 | Design | Default columns Added, Opened, Rating | Taste | P1 | Rating visible invites use; history columns opt-in |
| 11 | Design | Rating via dialog at every width | Mechanical | P5 | 5 x 40 px does not fit a phone meta line |
| 12 | Design | Move Undo lives with its toast | Taste | P3 | Persisted move journal is row 6 |
| 13 | Eng | Buffered external flush with event-time context | Mechanical | P1 | Child-first deletes, no per-event Trash read |
| 14 | Eng | Worker is the single writer of folder prefs | Mechanical | P5 | No field loss, change broadcast |
| 15 | Eng | `META_PATCH` allowlist | Mechanical | P1 | Unchecked spread today |
| 16 | Eng | Backup metadata section | Mechanical | P1 | Ratings would be lost otherwise |
| 17 | Eng | History via `getVisits` for displayed URLs | Mechanical | P5 | Exact semantics, bounded cost |
| 18 | Eng | External restore in reverse event order, dedupe identical bookmarks | Mechanical | P1 | Correct order; no cross-device duplicates |
| 19 | Eng | Bulk move normalises roots, snapshots positions | Mechanical | P1 | Nested selections, Undo order |

## Gate

The owner's standing instruction for this release ("go ahead with implementation of plans for
1.4.0", without check-ins) is treated as approval of the recommendations (gate option A). User
challenge UC1 (split the release or wait for 1.3.0 field feedback) and taste decisions 5, 6, 10
and 12 are reported to the owner with the finished build; the owner's direction stands until
they change it.

## GSTACK REVIEW REPORT

| Review | Status | Notes |
|---|---|---|
| CEO | issues resolved in plan | 1 user challenge, 7 fixes |
| Design | 12 decisions resolved | scores 3 to 6 -> 8 to 9 |
| Eng | issues resolved in final spec | 19 decisions, test plan written |
| Voices | codex + subagent, all phases | consensus 6/6 CEO, 6/6 eng |
