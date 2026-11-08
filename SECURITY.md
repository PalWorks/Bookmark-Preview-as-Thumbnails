# Security

_Last updated: 2026-11-08T10:20:54+00:00 (1.3.0: Trash message checks, settings import rules, bundle scan)._

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
| Content script (runs inside third-party pages) | Cannot call `META_PATCH` or any `TRASH_*` message: the worker rejects senders whose URL is not an extension page. |
| Incognito worker (split mode) | Trash is read-only there; mutations are rejected. |
| Backup and settings files (user-supplied, possibly shared) | Only allowlisted settings with valid types are applied; custom endpoints must be http(s) without credentials, query or fragment; provider and endpoint are never changed while a key is saved; only `data:` image URLs are decoded (no fetches to arbitrary URLs). |
| Restore destination | Never chosen across storage scopes (local vs synced) without the user picking it. |
| Managed bookmarks | Never deleted; a request that includes one is rejected as a whole. |
| Extension pages | CSP `script-src 'self'; object-src 'self'`; no remote code. |

## Permissions

See PRIVACY_DETAILS.md for the justification of each permission. New permissions must not add an
install warning (DECISIONS.md D3).
