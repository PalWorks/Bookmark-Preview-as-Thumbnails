# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-11-08T13:24:59+00:00

Organise and recover: the rest of the requests from the user who asked for bookmark manager
parity, plus recovery of bookmarks deleted outside this extension.

### Added

- **Deletes made outside the extension go to Trash.** Bookmarks and folders deleted in Chrome's
  own bookmark manager, by sync or on your other devices land in Trash while Chrome is open on
  this computer, as one row per burst marked "Deleted outside this extension", and restore like
  any other delete (to the original place, in the original order, or a folder you pick). A
  bookmark or folder that already came back from another device is not duplicated. A switch at
  the top of Trash turns this off; what is already kept stays.
- **Select several items.** A **Select** button in the top bar, checkboxes on tiles and rows,
  Shift+click for a range, Ctrl/Cmd+A for everything in view, Escape to stop. The selection bar
  (bottom of the screen on phones) offers **Move to...**, **Delete** and **Open**. Delete is one
  Undo; Move has Undo in its toast; opening more than 20 tabs asks first, inside the bar.
- **Folder colours**: eight colours plus the default yellow, from a folder's **More actions**
  menu, shown in the folder panel, tiles, list rows, Trash and the folder picker.
- **Hide folders from search**: from a folder's **More actions** menu. Matches inside hidden
  folders (and their subfolders) are held back with "N more matches in folders hidden from
  search · Show them". Smart Search leaves them out too.
- **List view columns**: Added, Opened (from this page or Chrome's bookmark manager), Rating (1
  to 5 stars, per link), and with Chrome's optional history permission Visits and Last visited.
  A **Columns** menu chooses them; Sort gains Recently opened, Rating and Most visited.
- **Backups** now include ratings, tags and opened times for every link, and folder colours and
  hidden folders by folder path; settings exports include the folder choices too.

### Changed

- The top bar never truncates the title between 720 and 1599 px: Filter and Sort become icon
  buttons below 1280 px, the Select label below 1440 px.
- Restoring a delete also brings back the folder's colour and search setting.

### Fixed

- Metadata written by extension pages and backups is checked field by field: wrong types, unknown
  fields and oversized values are dropped. Importing a backup never overwrites a rating or tags
  you set on this device.

### Permissions

- Adds `history` as an **optional** permission, requested only when you turn on Visits or Last
  visited. Install warnings are identical to 1.3.0 (checked on Chrome 156).

### Developer

- `src/sw/folder_prefs.ts` (single writer of `fpref_*`), `src/lib/metadata_sanitize.ts`
  (allowlist), `src/lib/bulk_move.ts`, `src/lib/list_columns.ts`; hooks `useSelection`,
  `useLinkMeta`, `useHistoryStats`, `useFolderPrefs`.
- `npm run e2e`: a real-Chrome smoke test in a throwaway headless profile.
- 322 tests (257 before).

## [1.3.0] - 2026-11-08T12:18:14+00:00

A safer, more familiar bookmark manager: every delete can be undone, and the
gaps against Chrome's own bookmark manager reported by a daily user are closed.

### Added

- **Trash with Undo.** Deleting a bookmark or folder in this extension (tile button,
  list row, right-click menu, Delete key, or Duplicate Finder) moves it to Trash and
  shows a toast with **Undo** (also Ctrl+Z or Cmd+Z). Undo puts it back where it was,
  with the same titles, links, order and subfolders; previews and AI tags come back
  without a recapture. A Duplicate Finder "remove all" is one Undo.
- **Trash view** (sidebar, or the settings menu): one row per delete with previews,
  original location, and when it expires. Restore, Restore all, Retry, and
  **Restore to...** (a folder picker grouped by "On this device" and "Synced to your
  account"). Items stay 30 days, then they and their cached previews are removed.
  **Empty Trash** asks you to type EMPTY and also removes previews no other bookmark
  uses.
- **Delete button on every tile and row**, always visible (no hover needed), with a
  text label in list view.
- **Site icons for bookmarks without a preview**, from Chrome's local favicon cache,
  with the domain underneath, instead of "No Preview".
- **Folder counts include subfolders** (sidebar and folder tiles), with a tooltip
  saying so.
- **Yellow folder icons**, readable in light and dark themes.
- **Show or hide the folder panel** with the new **Folders** button; the choice is
  remembered. On phones and narrow windows the panel becomes a drawer.
- **Export Settings**: a small file with your preferences only (no previews, never an
  API key). Import accepts it as well as full backups.
- The page now updates by itself when bookmarks change anywhere (another tab, Chrome's
  bookmark manager, sync, an import).

### Changed

- **Works on small screens** (360px wide and up): compact top bar, full-width search,
  one-column grid, folder drawer, full-width toast and dialogs.
- **Keyboard and screen reader support**: real buttons throughout, visible focus
  rings, arrow keys in menus, Escape closes menus, drawers and dialogs, and focus moves
  to the next item after a delete. Touch targets are at least 40px.
- Backup import and export messages appear as a toast instead of a pop-up, and an import
  applies without reloading the page.
- Pasting a copied folder keeps its children in their original order.
- Settings import ignores unknown settings and wrong types, and never changes the AI
  provider or server address while an API key is saved (it asks you to review AI
  Settings instead).

### Fixed

- The storage warning banner was unstyled outside list view.
- Opening a folder after it was deleted elsewhere now falls back to its parent.
- Faint helper text did not meet contrast guidelines.
- The browser tab was titled "bookmarks-thumbnails"; it now reads "Bookmarks as Thumbnails".
- The search box showed a second, square focus ring inside the rounded field.
- In narrow windows the preview and view buttons were 24px tall; they are now 40px.
- The Undo toast no longer runs out while the tab is in the background; its 8 seconds
  restart when you come back.
- In the Restore to... picker, long folder paths no longer shrink the radio button.

### Permissions

- Adds `favicon` (site icons) and `alarms` (daily Trash clean-up). Chrome shows no new
  install warning for either; verified on Chrome 156 that the warning list is identical
  to 1.2.1.

### Licence

- Now `AGPL-3.0-only` with a paid commercial licence for use without AGPL obligations.
  `LICENSE` holds the unmodified AGPL 3.0 text; see `COMMERCIAL-LICENSE.md`. Source files
  carry SPDX headers.

### Developer

- Trash runs in the service worker (`src/sw/trash.ts`) as the single writer, with crash
  recovery and resumable restores; see `ARCHITECTURE.md` and `DATA_MODEL.md`.
- In-memory Chrome bookmarks fake for tests; 257 tests (160 before).
- CI runs `npm run check:bundle` after the build: no DOM or React in the service worker,
  no secrets, no source maps.

## [1.2.1] - 2026-11-08T03:30:39+00:00

### Fixed

- **Updates no longer touch saved AI settings.** The update step used to rename every
  extension-local storage key it did not recognise, which would have removed the saved
  AI API key on the first update after 1.2.0. It now runs once per storage version and
  only moves old-format preview records.
- **AI tags survive a recapture.** Regenerating a preview, a failed capture, a backup
  import or a manual tag edit no longer overwrites the bookmark's tags. Writes for the
  same bookmark are applied one after another.

### Security

- **The saved API key stays with its provider.** The key is now tied to the provider
  (and, for custom or local servers, the server address) it was entered for. If the
  provider or address changes without the key being re-entered, the key is not sent and
  AI Settings asks for it again. Editing the server address in AI Settings no longer
  checks the saved key against the new address. Keys saved by earlier versions are tied
  to the current settings during this update. Local servers that need no key (Ollama,
  custom) keep working when a key for another provider is saved.

## [1.2.0] — 2026-06-03

### Added

- **AI Auto-Tag** — automatically categorise bookmarks with open-vocabulary tags.
  Uses Chrome's built-in Gemini Nano (on-device, nothing leaves your machine) by
  default, or any cloud provider / local server with your own API key.
- **Smart Search** — natural-language bookmark search powered by the same AI backend.
- **Duplicate Finder** — detect and merge duplicate bookmarks; shows folder and date
  detail; supports keep-oldest / keep-newest merge strategy.
- **AI Settings page** — configure built-in vs. cloud mode, provider, model, API key
  validation, model discovery, and preferred auto-tag vocabulary.
- **Cancellable batch capture** — Stop now aborts in-flight captures immediately via
  AbortController; previously it waited out full navigation timeouts.
- Architecture diagram (`architecture.d2`).
- Developer documentation (`agents.md`, `CONTRIBUTING.md`).
- GitHub Issue and PR templates.

### Changed

- Updated `README.md` and `PRIVACY.md` to accurately describe cloud-AI data flow.
- Updated `PRIVACY_DETAILS.md` (Chrome Web Store privacy questionnaire).

### Fixed

- Gemini API key is now sent via `x-goog-api-key` header, never embedded in the URL.
- Backup import validates bookmark IDs/URLs and only fetches `data:` URLs (prevents SSRF).
- File System Access handle is only retained when permission is actually granted.
- Auto-capture re-checks the batch guard after its `await` to prevent double-queuing.
- `error_generator` FileReader now rejects on error (no worker hang).
- AI Settings save-confirmation timers are guarded against setState-after-unmount.
- TopBar search input is controlled and clears on folder navigation.

## [Unreleased]

### Added

- Deployment visualization in architecture diagram.
