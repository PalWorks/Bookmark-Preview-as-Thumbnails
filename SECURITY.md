# Security

_Last updated: 2026-11-09T17:05:16+00:00 (1.7.0: AI change sets and the coding-agent bridge)._

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
- The feedback relay (`worker/`, D16) holds a send-only Resend key scoped to palworks.ai and an
  `IP_HASH_SECRET`, both as Cloudflare Worker secrets, never in the repository.

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
| AI change sets (pasted, from a file, or from a coding agent) | Untrusted input: parsed with limits (1 MB, 200 changes, 1,000 items removed), control and bidi characters stripped, rendered as text; validated by simulation against the live tree; ids outside the shared folders or inside hidden ones read as unknown; nothing changes without the user's Apply; Trash contents are frozen at approval; Undo never overwrites a newer change. |
| Coding-agent bridge (local programs of the same OS user) | Optional `nativeMessaging`, requested from a click. The host listens on a 0600 Unix socket in a 0700 folder it checks with `lstat` (no links, same owner) and keeps no state. Pairing needs a 6-digit code shown only in the extension, bound to the client's random pairing id, 2-minute life, 3 tries, 5 prompts an hour, blockable per name. Tokens are 32 random bytes; only their SHA-256 is stored; they never appear in output, errors or logs. Each agent reads only the folders the user ticks (never hidden ones) and proposes only if allowed. At most 4 connections and 64 KB per request. The regular worker only. |
| Feedback relay (public, unauthenticated endpoint) | JSON only, 16 KB body, 4,000-character message, plausible-email check, honeypot; accepts only our extension's origins (a web page from any other origin gets 403); per-network burst and hourly limits plus a daily global cap, counted atomically in a Durable Object that refuses when it cannot count (an IPv6 sender counts as its /64); a failed send gives the allowance back; generic errors that never echo the provider's response; stores only rate-limit counters keyed by an HMAC of the network, deleted within 26 hours. |

## Permissions

See PRIVACY_DETAILS.md for the justification of each permission. New permissions must not add an
install warning (DECISIONS.md D3). The optional `history` permission is requested only from a
click and checked with `chrome.permissions.contains` before every use; it was verified to add
no install warning (Chrome 156, 2026-11-08). The optional `nativeMessaging` permission (1.7.0)
follows the same rule; `management.getPermissionWarningsByManifest` returned the same warnings with
and without it (2026-11-09).
