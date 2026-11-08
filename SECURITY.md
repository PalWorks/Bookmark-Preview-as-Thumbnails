# Security

_Last updated: 2026-11-08T13:24:59+00:00 (1.4.0: folder prefs and metadata allowlists, external deletes, optional history permission)._

## Reporting a vulnerability

Open a GitHub issue titled "Security" without exploit details and ask for a private channel, or
use GitHub's private vulnerability reporting for this repository if it is enabled. Do not post
working exploits or keys publicly.

## Secrets

- The only secret the extension handles is the user's own AI API key. It is encrypted at rest
  (AES-256-GCM, key in `chrome.storage.local`), bound to its provider and endpoint origin, and
  sent only to that provider. It never appears in backups, settings exports or logs.
- No API keys, tokens or provider secrets are part of the repository or the bundle. CI runs
  `scripts/check-bundle.mjs` after every build: it fails on key patterns (Google, OpenAI and
  Anthropic style, GitHub, Slack, Resend, JWT, private keys, webhook URLs) and on source maps.

## Trust boundaries

| Boundary | Rule |
|---|---|
| Content script (runs inside third-party pages) | Cannot call `META_PATCH`, `FOLDER_PREFS_SET` or any `TRASH_*` message: the worker rejects senders whose URL is not an extension page. |
| Extension pages writing metadata | `META_PATCH` keeps only allowlisted fields with valid values (rating 1 to 5, times not in the future, tags capped at 20 of 50 characters, known capture statuses); ids at most 2,048 characters. |
| Folder prefs | Only the worker writes them; ids must be existing, non-root folders; colours from a fixed list. |
| Deletes made outside the extension | Recorded from Chrome's own `onRemoved` events only (no message can create an external entry); policy-managed bookmarks are not kept. |
| Incognito worker (split mode) | Trash is read-only there; mutations are rejected. |
| Backup and settings files (user-supplied, possibly shared) | Only allowlisted settings with valid types are applied; metadata records pass the same allowlist as `META_PATCH` and never overwrite a stored rating or tags; folder prefs apply only to one exact title path (at most 2,000 items, 64-part paths); custom endpoints must be http(s) without credentials, query or fragment; provider and endpoint are never changed while a key is saved; only `data:` image URLs are decoded (no fetches to arbitrary URLs). |
| Restore destination | Never chosen across storage scopes (local vs synced) without the user picking it. |
| Managed bookmarks | Never deleted; a request that includes one is rejected as a whole. |
| Extension pages | CSP `script-src 'self'; object-src 'self'`; no remote code. |

## Permissions

See PRIVACY_DETAILS.md for the justification of each permission. New permissions must not add an
install warning (DECISIONS.md D3). The optional `history` permission is requested only from a
click and checked with `chrome.permissions.contains` before every use; it was verified to add
no install warning (Chrome 156, 2026-11-08).
