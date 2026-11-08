# Decisions

_Last updated: 2026-11-08T09:06:39+00:00 (1.2.1 and 1.3.0 decisions recorded)._

Architecture decision records: why things are the way they are. Newest first. Each ends with
the rule it imposes. Detailed reasoning for 1.3.0 is in
[docs/designs/release-1.3.0-safe-delete-and-parity.md](docs/designs/release-1.3.0-safe-delete-and-parity.md).

## D9. Licence: AGPL-3.0-only plus a paid commercial licence (owner, 2026-11-08)

The repository already offered "free (AGPL) plus commercial", 1.2.x shipped under AGPL, and
the website prices a commercial licence. PolyForm Noncommercial was the alternative; it would
have changed terms going forward only and contradicted the published pricing.

**Rule: `LICENSE` holds the unmodified AGPL 3.0 text; every source file carries
`SPDX-License-Identifier: AGPL-3.0-only`; commercial terms live in COMMERCIAL-LICENSE.md.**

## D8. Trash is owned by the service worker, for extension deletes only (owner, 2026-11-08)

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
