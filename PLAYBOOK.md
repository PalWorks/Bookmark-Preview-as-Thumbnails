# Playbook

_Last updated: 2026-11-08T13:24:59+00:00 (1.4.0: e2e smoke, optional permissions in the gate, folder prefs rules)._

Step-by-step procedures. Conventions and rules are in [AGENTS.md](AGENTS.md).

## Implement a change

1. Branch from `main` (`release/<version>` for a release, `fix/<topic>` otherwise).
2. New behaviour goes into a hook in `src/popup/hooks/` or a module in `src/lib/`;
   `App.tsx` only composes. Worker logic with state goes into its own module under
   `src/sw/` with no import side effects.
3. Delete anything through `useTrash().deleteItems` (never `chrome.bookmarks.remove`).
   Write metadata through `storageIndex.patch` (worker) or `patchMetadata` (page).
4. Add tests next to the area (`tests/`); use the bookmarks fake for anything that touches
   `chrome.bookmarks`, and `tests/sw_bridge.ts` to run page code against the real worker logic.
5. `npm run lint`, `npm test -- --run`, `npm run build`, `npm run check:bundle`, `npm run e2e`.
6. Check 360px and desktop widths, light and dark (see "Browser QA" below).

## Release to the Chrome Web Store

1. Bump `version` in `package.json` and `public/manifest.json` (and the lockfile with
   `npm install --package-lock-only`).
2. Add the CHANGELOG entry with a UTC timestamp (`date -u --iso-8601=seconds`).
3. If permissions changed, run the permission gate below. Update PRIVACY.md and
   PRIVACY_DETAILS.md in the same change.
4. Open a PR to `main`; CI must pass (lint, test, build, bundle check).
5. Merge, then tag with `TZ=UTC git tag -a v<version>` and push the tag.
6. `npm run zip` (builds, runs the bundle check, writes `extension.zip`). Confirm the zip has
   no `.map` files.
7. Upload `extension.zip` with the maintainer's Chrome Web Store CLI credentials (item id
   `eedekafhclngkhhkcocblnllkbodgnhj`; machine-specific commands are in the gitignored
   `LOCAL.md`). Uploading while an older version is still in review replaces that submission.
8. After approval: install from the store on a clean profile, confirm the version, confirm a
   saved AI key and Trash still work after updating from the previous version. Update the
   website feature list in `website/` (deploys from `main`).

## Permission gate (no new install warnings)

Load a throwaway unpacked helper extension that holds the `management` permission (never add
`management` to this extension), then in its service worker:

```js
await chrome.management.getPermissionWarningsByManifest(oldManifestJson);
await chrome.management.getPermissionWarningsByManifest(newManifestJson);
```

The two lists must be identical. Remove the helper afterwards. Optional permissions
(`optional_permissions`, such as `history` in 1.4.0) are not part of the install warnings; still
run the gate when they change, and ask for them only from a click.

## Browser QA

A maintainer's own Chrome may have this repo's `dist/` loaded unpacked, so a local
`npm run build` changes that install. For development QA, build to a scratch folder
(`npx vite build --outDir <dir>`) and use a separate headless Chrome with a throwaway profile:

```bash
google-chrome --headless=new --remote-debugging-port=9333 --enable-unsafe-extension-debugging \
  --user-data-dir=<scratch>/profile --no-first-run about:blank
```

Load the build with CDP `Extensions.loadUnpacked`; loading the same path again simulates an
update (`onInstalled` with reason `update`). Open extension pages as foreground targets in the
headless browser: background tabs throttle timers to about one per second. Never take focus in
the owner's own browser.

Check: update path (saved API key decrypts, tags kept, `trash-purge` alarm present); delete,
Undo, Trash, Restore to..., Empty; no horizontal scroll at 360px; no console errors.

1.4.0 additions: delete a folder with the bookmarks API from the extension page (as Chrome's
manager would) and confirm one "Deleted outside this extension" row after 3 seconds that restores
with its colour; select a range and bulk delete, move and Undo; list view columns and the Rating
dialog; turn on Visits (Chrome's permission prompt) and decline once; the top bar from 720 to
1599 px never truncates the title. When QA runs in a maintainer's own browser, use background
targets only and expect slower timers there.

Owner-profile QA (a real profile with real bookmarks) puts its test data in its own folder,
snapshots bookmark and folder counts first, and removes the data and its Trash entries
afterwards.

## Roll back

The Web Store cannot downgrade. A rollback is a new, higher version built from the previous
code. It must keep the schema-gated migration (`src/lib/storage_migration.ts`) and must not
rename `trash_*` keys; older code that predates 1.2.1 would destroy them. Trash keys are inert
if the Trash UI is removed.

## Debug

- Service worker logs: `chrome://extensions` → the extension → "service worker". Trash logs are
  prefixed `[Trash]` with the operation id; failed entries show their error in the Trash view.
- Storage: in the worker console, `await chrome.storage.local.get(null)`; Trash keys start with
  `trash_`.
