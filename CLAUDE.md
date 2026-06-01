# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Bookmarks Thumbnails** — a Chrome extension (Manifest V3) that captures webpage
screenshots and displays them as visual thumbnails for your bookmarks. Built with
React + TypeScript + Vite. There is also a marketing `website/` (separate Next.js-style
landing page) in the same repo.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build  → outputs to dist/
npm run lint     # ESLint (flat config; CI-blocking — see below)
npm test         # Vitest (use `npm test -- --run` for one-shot, as CI does)
npm run zip      # Package dist/ into extension.zip for the Web Store
```

Load the unpacked extension from `dist/` at `chrome://extensions` (Developer mode) to
test manually. The popup/main UI opens as a full page (`index.html`), not a small popup.

## Architecture

The extension has three runtime contexts; keep their boundaries in mind:

- **Service worker** ([src/sw.ts](src/sw.ts)) — message router + capture orchestration.
  Owns batch capture (hidden window, worker pool with configurable concurrency),
  auto-capture on bookmark creation, and storage migration on update. **Message
  listeners that respond asynchronously must `return true` synchronously** (not be
  `async`) — otherwise Chrome closes the message channel. This was a shipped bug; don't
  reintroduce it.
- **Content script** ([src/content/capture.ts](src/content/capture.ts)) — page-side capture helper.
- **Popup/main UI** ([src/popup/](src/popup/)) — React app. `App.tsx` is intentionally
  thin: it composes hooks and renders components. All stateful logic lives in
  [src/popup/hooks/](src/popup/hooks/) (`useThumbnails`, `useBookmarkTree`, `useSettings`,
  `useContextMenu`, `useClipboard`, `useStorageWarning`). Add new behavior as a hook, not
  inline in `App.tsx`.

### Storage model (`src/lib/`)

- `thumbnail_storage.ts` — image blobs persisted in `chrome.storage.local` as base64 under
  `thumb_<id>` keys.
- `storage_index.ts` — metadata records under `meta_<id>` keys (title, status, timestamps).
- `fsaccess.ts` — optional File System Access API: when the user "connects a folder",
  thumbnails are also written to disk (`saved_disk` status).
- `backup_manager.ts` — export/import a JSON backup (`version: 1`; importer rejects
  higher versions and whitelists which sync settings it restores).
- The `id` used as a storage key is the **original bookmark URL**, even though the captured
  tab's URL may differ after redirects. Lookups always use the original URL.

### Capture flow

`BATCH_CAPTURE` message → SW opens a hidden window → worker pool navigates tabs, waits for
load + a configurable render delay → `captureManager.capture()` → resize/compress to webp →
persist to storage (and disk if connected) → broadcast `THUMBNAIL_UPDATED`. The popup's
`useThumbnails` hook listens for `CAPTURE_STARTED` / `THUMBNAIL_UPDATED` / `CAPTURE_FAILED` /
`BATCH_STOPPED` and reconciles its `loadingUrls` / `queuedUrls` / `thumbnails` sets.
Failed navigations produce a generated error-image thumbnail rather than nothing.

## Conventions

- **Object URLs**: `useThumbnails` creates `URL.createObjectURL` blobs for display and is
  careful to `revokeObjectURL` the old one on replace and all of them on unmount. Preserve
  this when touching thumbnail rendering — it's the memory-leak guard.
- **Stale closures**: hooks that read state inside long-lived listeners/effects mirror that
  state into refs (see `useThumbnails`). Follow that pattern rather than widening effect deps.
- Tests live in [tests/](tests/) with jsdom + a Chrome API mock in [tests/setup.ts](tests/setup.ts).
  `tests/phase1_regression.test.ts` guards the three originally-shipped bugs — keep it green.

## CI

[.github/workflows/extension-ci.yml](.github/workflows/extension-ci.yml) runs **lint → test →
build**, all three of which currently pass clean. Lint is a hard gate (`npm run lint` must be
error-free), so run it before pushing — don't assume green just because the build succeeds.
Note `eslint.config.js` enables the React Compiler rule bundle (`react-hooks/set-state-in-effect`,
`preserve-manual-memoization`): keep async work behind an `await` boundary inside effects, and
don't reintroduce manual `useMemo`/`useCallback` whose dependency lists can't be preserved.

## Docs worth reading

`CODEBASE_REVIEW.md` (the original audit), `IMPLEMENTATION_PLAN.md` (the 6-phase roadmap that
produced the current branch), and `architecture.svg`/`.d2` (system diagram).
