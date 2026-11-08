# TODOS

Updated 2026-11-08T03:21:04+00:00 by /autoplan for release 1.3.0.

## Product (1.4.0 candidates)

### Record deletions made outside the extension in Trash

**What:** Capture bookmarks removed in Chrome's own manager (or by sync) into Trash via `bookmarks.onRemoved`.

**Why:** Owner chose this in office hours; deferred from 1.3.0 at the autoplan gate because it depends on untested Chrome behaviour.

**Context:** First run a spike on stable Chrome answering: does `removeInfo.node` include descendants; does `removeTree` fire once or per node; is `storage.local` shared with split incognito. Sync sign-out also fires `onRemoved` for account bookmarks, so hide Restore for `syncing` external entries. Design notes in docs/designs/release-1.3.0-safe-delete-and-parity.md (A9 and the removed external-capture section).

**Effort:** M
**Priority:** P2
**Depends on:** 1.3.0 trash service

### Exclude chosen folders from search

**What:** Let users mark folders (for example a bookmarklets folder) whose contents never appear in search or Smart Search.

**Why:** Requested in the 2026-11-06 user email (item 5); utility bookmarks pollute results.

**Context:** `useBookmarkTree` search uses `chrome.bookmarks.search`, which returns a flat list; filter by an ancestor set built from the in-memory tree. Store the excluded ids in `chrome.storage.sync`.

**Effort:** S
**Priority:** P2
**Depends on:** None

### List view columns

**What:** Optional, toggleable columns in list view: last opened (`BookmarkTreeNode.dateLastUsed`, no new permission), date created, a 3-star rating stored per URL, and visit count.

**Why:** Requested in the user email (item 7); "last visited" called out as most important.

**Context:** Visit count needs the `history` permission, which shows the warning "Read and change your browsing history on all signed-in devices"; request it as an optional permission only when the column is enabled.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Range multi-select with bulk actions

**What:** Shift-click and drag selection of bookmarks, with bulk delete, move and open.

**Why:** Requested in the user email (item 9).

**Context:** Needs a selection model in a new hook; bulk delete goes through the 1.3.0 trash service as one operation.

**Effort:** M
**Priority:** P2
**Depends on:** 1.3.0 trash service

### Per-folder colours

**What:** Let users pick a colour per folder, beyond the 1.3.0 yellow default.

**Why:** Requested in the user email (item 2).

**Context:** Store `{ folderId: colour }` in sync storage; reuse the 1.3.0 folder tokens.

**Effort:** S
**Priority:** P3
**Depends on:** 1.3.0 folder tokens

### Open this UI from Chrome's bookmark manager shortcut

**What:** Evaluate `chrome_url_overrides.bookmarks` so Ctrl+Shift+O opens this extension.

**Why:** Turns the extension from a separate tab into the bookmark manager itself (CEO review 10x frame).

**Context:** Check the Web Store single-purpose policy and any prompt Chrome shows for the override on an unpacked build before committing.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Undo for rename and move

**What:** Extend the trash operation journal so rename, cut/paste and move also get an Undo toast.

**Why:** Consistent recovery for every destructive edit.

**Context:** The 1.3.0 SW coordinator and operation ids are the base.

**Effort:** M
**Priority:** P3
**Depends on:** 1.3.0 trash service

## Infrastructure

### Automated browser E2E for the extension

**What:** A Playwright harness that loads the unpacked `dist/` and runs the update, delete/Undo, restore and 360px checks.

**Why:** 1.3.0 relies on a manual checklist for Chrome-only behaviour.

**Context:** Chromium supports loading extensions with a persistent context; WebKit does not.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Migrate existing CSS to design tokens

**What:** Move hard-coded colours in App.css, TopBar.css and ThumbnailTile.css onto the 1.3.0 token set.

**Why:** Only 2 `var(--)` uses exist today; themes are duplicated per selector.

**Context:** Tokens land in `src/popup/index.css` in 1.3.0 for new components only.

**Effort:** S
**Priority:** P3
**Depends on:** 1.3.0 tokens

## Completed
