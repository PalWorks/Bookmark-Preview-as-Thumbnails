# Decisions

_Last updated: 2026-11-09T05:16:27+00:00 (1.6.0: D16)._

Architecture decision records: why things are the way they are. Newest first. Each ends with
the rule it imposes. Detailed reasoning is in
[docs/designs/release-1.3.0-safe-delete-and-parity.md](docs/designs/release-1.3.0-safe-delete-and-parity.md) and
[docs/designs/release-1.4.0-organise-and-recover.md](docs/designs/release-1.4.0-organise-and-recover.md).

## D16. Feedback goes through our own relay, never straight to the mail provider (2026-11-09)

The owner asked for a feedback form inside the extension, sent with Resend. A published
extension is a zip anyone can unpack, so a Resend key in the bundle would be a public key that
anyone could use to send mail as palworks.ai. The form posts instead to a Cloudflare Worker
(`worker/`, copied from the proven Gmail Labels as Tabs relay) that holds a send-only Resend key
scoped to the palworks.ai domain. The Worker validates hard (JSON only, 16 KB, 4,000-character
message, honeypot), accepts only our extension's origins, rate limits per network (burst binding,
5 an hour, 30 a day for everyone: owner decision 2026-11-09), stores no message content, and names networks by an HMAC of
the address (an IPv6 /64 counts as one network), never the address. The pre-landing review of
PR #11 (Claude and Codex agreeing) found the first version's KV counters non-atomic and failing
open under a flood; this relay shares the Resend account with other palworks.ai senders, so the
counters moved to a Durable Object (`worker/src/limiter.ts`) that counts exactly and refuses when
it cannot count, and a failed send gives its allowance back.

**Rule: no provider key ever ships in the extension. New network calls from the extension go to
a server we run that holds the key, and are listed in PRIVACY.md and SECURITY.md.**

## D15. Undo for rename and move lives in the toast and never overwrites a newer change (2026-11-08)

ROADMAP row 6 proposed a persisted journal of renames and moves in the worker. 1.5.0 ships the
part users reach for (Undo right after the change, by button or Ctrl/Cmd+Z) in the page, like
bulk move (D14), and defers the journal (ROADMAP row 15): it needs a history view and rules for
changes made in Chrome's manager or by sync in between, for a mistake users notice at once. Each
Undo checks first: a rename is reverted only while the item still has the name we gave it, a move
only while the item is still in the folder we moved it to. Two gaps are accepted: Chrome has no
compare-and-set, so a rename landing between the check and the write can still be overwritten,
and a reorder inside the destination folder does not block a move's Undo.

**Rule: rename and move Undo never overwrite a change made after ours; anything that cannot be
reverted says so in the toast.**

## D14. Bulk move Undo lives in the page, as long as its toast (2026-11-08)

A persisted move journal is the larger "Undo for rename and move" work (ROADMAP row 6). Bulk move
records every original position before moving, so its Undo is exact while the page is open.

**Rule: the move toast offers Undo and promises nothing beyond it; do not describe moves as
recoverable from Trash.**

## D13. History is an optional permission, read for what is on screen (2026-11-08)

Visit counts need `history`. As a required permission it would add an install warning (D3) and
disable the extension for every user until re-approved.

**Rule: `history` stays in `optional_permissions`, is requested only from a click (first call),
is checked before every use, and its data is read per visible link and never stored.**

## D12. Folder prefs are per device, keyed by folder id, exported by path (2026-11-08)

Bookmark ids differ between devices, so sync storage keyed by id would apply colours to the
wrong folders. Title paths are not unique enough to be the key.

**Rule: `fpref_<id>` lives in `chrome.storage.local`, written only by the worker; exports name
folders by title path and import applies an item only to the one folder with that exact path.
The UI says "on this device".**

## D11. Page-written metadata passes an allowlist (2026-11-08)

`META_PATCH` used to spread whatever a page sent into `meta_<url>`. Ratings and opened times made
pages write more fields, and backups feed the same path.

**Rule: every field a page or a backup may write is listed with its validator in
`src/lib/metadata_sanitize.ts`; conditional merges (backup import) run inside the worker's
per-URL queue.**

## D10. Deletes made outside the extension go to Trash too (owner direction, 2026-11-08)

The user's main remaining loss was a folder deleted in Chrome's own manager or by sync. The
Chrome behaviour this depends on was verified on Chrome 156. Recording is best effort: only while
Chrome runs on this device, and never for an account tree disappearing at sign-out or for
policy-managed bookmarks. Users can turn it off in the Trash view (default on).

**Rule: external entries are written only from `chrome.bookmarks.onRemoved`, buffered and
recorded inside the Trash queue; the extension's own removals must be marked before they
happen so they are never recorded twice.**

## D9. Licence: AGPL-3.0-only plus a paid commercial licence (owner, 2026-11-08)

The repository already offered "free (AGPL) plus commercial", 1.2.x shipped under AGPL, and
the website prices a commercial licence. PolyForm Noncommercial was the alternative; it would
have changed terms going forward only and contradicted the published pricing.

**Rule: `LICENSE` holds the unmodified AGPL 3.0 text; every source file carries
`SPDX-License-Identifier: AGPL-3.0-only`; commercial terms live in COMMERCIAL-LICENSE.md.**

## D8. Trash is owned by the service worker (owner, 2026-11-08; extended by D10)

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
