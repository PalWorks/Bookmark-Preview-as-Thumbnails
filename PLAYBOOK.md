# Playbook

_Last updated: 2026-11-11T06:01:16+00:00 (second audit: answers kept across a reconnect, docs brought in line)._

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
5. `npm run lint`, `npm test -- --run`, then build into a scratch folder (`npx vite build --outDir
   <scratch>/build`; never `npm run build` on a feature branch, it changes the maintainer's unpacked
   install), `node scripts/check-bundle.mjs <scratch>/build`, `node scripts/e2e/smoke.mjs <scratch>/build`.
6. Check 360px and desktop widths, light and dark (see "Browser QA" below).

## Release to the Chrome Web Store

1. Bump `version` in `package.json` and `public/manifest.json` (and the lockfile with
   `npm install --package-lock-only`).
2. Add the CHANGELOG entry with a UTC timestamp (`date -u --iso-8601=seconds`).
3. If permissions changed, run the permission gate below. Update PRIVACY.md and
   PRIVACY_DETAILS.md in the same change.
4. Open a PR to `main`; CI must pass (lint, test, build, bundle check, real-Chrome smoke test).
   GitHub Actions are kept to the minimum (owner, 2026-11-09): CI is one job that runs only on
   pull requests that change code, never on pushes to `main`. Run the full set locally first,
   push each branch as few times as possible, and put docs-only changes in their own PR (no CI)
   or fold them into the next code PR.
5. Merge once the diff is reviewed and CI passes (the owner does not need to be asked, 2026-11-10),
   rebuild `dist/` from `main`, then tag with `TZ=UTC git tag -a v<version>` and push the tag
   (tags, npm and the Web Store still need the owner).
6. `npm run zip` (builds, runs the bundle check, writes `extension.zip`). Confirm the zip has
   no `.map` files.
7. Upload `extension.zip` with the maintainer's Chrome Web Store CLI credentials (item id
   `eedekafhclngkhhkcocblnllkbodgnhj`; machine-specific commands are in the gitignored
   `LOCAL.md`). Uploading while an older version is still in review replaces that submission.
   The CLI publishes (submits for review) by default; pass `upload` as the first argument to
   upload only, so the dashboard can be reviewed first.
7a. Before submitting, walk every dashboard page: Package (draft version and permissions),
   Store listing (description matches what ships), Privacy (a justification for every
   permission, data usage: since 1.6.0 the feedback form means "Personally identifiable information"
   and "Personal communications" stay ticked; for 1.7.0 follow PRIVACY_DETAILS.md section 5; from
   1.8.0 "User activity" is ticked too, PRIVACY_DETAILS.md section 4a), Distribution, Test instructions. The listing links the website
   privacy policy (`website/components/Legal.tsx`); keep it in line with PRIVACY.md. A
   submission locks the listing; "Cancel review" (menu at the top right) unlocks it.
   Never list brand, provider or site names in the description (for example the supported AI
   providers): the store rejects this as keyword spam (1.5.0 was rejected for it on 2026-11-08).
   Describe the capability instead ("the cloud AI provider of your choice").
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

## Coding-agent helper (`bridge/`, npm)

Published by hand, after the owner approves, together with the extension release that needs it.

1. `bridge/package.json` version equals `PACKAGE_VERSION` in `src/lib/bridge/protocol.ts`
   (`tests/bridge_version.test.ts` checks it); the setup snippet pins that version.
2. `cd bridge && node build.mjs && node --test test/*.test.ts`, then the real-Chrome run:
   `npx vite build --outDir <scratch>/build && node scripts/e2e/bridge.mjs <scratch>/build bridge/dist/cli.js`.
3. Scan `bridge/dist/` for keys like the extension bundle; it ships no source maps.
4. `cd bridge && npm publish --provenance --access public` (from CI or with an npm account that
   has 2FA). Publish before the extension release reaches users, so the snippet resolves.
5. Roll back with `npm deprecate bookmarks-thumbnails-mcp@<version> "<reason>"`; never unpublish a
   version people may have pinned.

## Feedback relay (`worker/`)

Deployed by hand, separately from extension releases; the owner approves each deploy.

1. `cd worker && npm ci`, then `npx --yes node@22.18 --test test/index.test.ts && npm run typecheck`.
2. `npx wrangler deploy`. Secrets (`RESEND_API_KEY`, `IP_HASH_SECRET`, and for usage
   statistics `GA4_API_SECRET` and `POSTHOG_KEY`) are set once with `npx wrangler secret put`,
   reading the value from a file or stdin; never in the repository or on a command line.
   Changing a secret takes effect without a redeploy.
3. Check `GET https://bookmarks-feedback.palworks.ai/health` returns `{ "ok": true }`, then
   send one message from an unpacked build. The Worker is also on its workers.dev address for
   1.6.0 and 1.7.0 copies; keep both until no supported version uses the old one. The Cloudflare
   account is shared with the owner's other projects (AGENTS rule 25).
4. Roll back with `npx wrangler rollback` to the previous version [Unverified: not yet exercised
   on this Worker]. Live logs: `npx wrangler tail`.
5. Usage statistics: send a batch with `"dev": true` from the unpacked build's origin to
   `POST /events` (expect 204, and 403 from any other origin). It shows in GA4 DebugView
   (property "Bookmarks as Thumbnails Website", stream "Chrome extension") and in PostHog EU
   project 344404 under Activity with `dev = true`. The relay never reports a GA4 or PostHog
   failure to the sender; check those services directly.

The extension's endpoints are fixed in `src/lib/feedback.ts` and `src/lib/analytics.ts`
(`ANALYTICS_ENDPOINT`); moving the relay needs an extension
release. Details and limits: [worker/README.md](worker/README.md).

## Online connector (`connector/`)

The Worker behind "Connect Claude or ChatGPT" (D20). The owner deploys it, sets its secret and
approves each deploy. It must be live before a release with the connector reaches users: the
extension's address is fixed in `CONNECTOR_ORIGIN` (`src/lib/bridge/connector.ts`,
`https://bookmarks-connector.palworks.ai`, a custom domain since 2026-11-10; 1.7.0 uses the
workers.dev address, which stays on), so moving it needs an extension release. The Cloudflare
account is shared with the owner's other projects: change only this Worker's own settings, never
the account's workers.dev name or another Worker's routes.

1. `cd connector && npm install`.
2. Set the secret once, never on a command line or in the repository:
   `openssl rand -base64 48 | npx wrangler secret put CLIENT_ID_SECRET`. Without it every OAuth
   and MCP endpoint answers 503.
3. `npm test && npm run typecheck && npm run smoke` (the smoke run starts `wrangler dev --local`
   and needs `connector/.dev.vars` with a local `CLIENT_ID_SECRET`). Then, from the repository
   root, the real-Chrome run: `npx vite build --outDir <scratch>/build && node
   scripts/e2e/connector.mjs <scratch>/build`.
4. `npx wrangler deploy`. `wrangler.toml` serves it on its custom domain and on workers.dev,
   with preview URLs off.
5. Check: `GET /.well-known/oauth-authorization-server` answers JSON (a 503 means
   `CLIENT_ID_SECRET` is missing); with an unpacked build,
   turn the switch on, add the address in Claude (Settings > Connectors > Add custom connector)
   and in ChatGPT (developer mode app), sign in with the code, list folders, apply one change
   and undo it.
6. Roll back with `npx wrangler rollback` to the previous version [Unverified: not yet
   exercised on this Worker]. Live logs: `npx wrangler tail` (they never contain bodies,
   tokens or codes).

**Rotating `CLIENT_ID_SECRET`** (only if it may have leaked): put a new value with step 2. Every
registered client id stops verifying, so each Claude or ChatGPT user must add the connector
again; tokens already issued keep working, because they are checked by the extension. To cut
off one user's apps, the user removes the connection or presses "Make a new address".

**Switching it off for everyone**: [Unverified: not exercised] remove the secret
(`npx wrangler secret delete CLIENT_ID_SECRET`) so every OAuth and MCP endpoint answers 503, or
`npx wrangler delete`. Ask AI and the local helper do not depend on the connector.

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
