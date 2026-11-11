# Security

_Last updated: 2026-11-11T05:30:59+00:00 (F2, F6 and F17 fixed: remote token expiry, connector token budgets, metadata writes across workers)._

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
  `IP_HASH_SECRET`, both as Cloudflare Worker secrets, never in the repository. For usage
  statistics (D27) it also holds `GA4_API_SECRET` (the Measurement Protocol secret of stream
  `G-Y7EQS9EYQB`) and `POSTHOG_KEY` (PostHog EU project 344404), so the extension carries no
  analytics key. The measurement id and the PostHog host are public settings in `wrangler.toml`.
- The online connector (`connector/`, D20) holds one secret, `CLIENT_ID_SECRET`, as a Cloudflare
  Worker secret (`.dev.vars` locally, gitignored). It signs client ids and the authorize page's
  form state, and keys the HMAC that names a network in the limiter. Without it every OAuth and
  MCP endpoint answers 503.
- Ask AI sends the user's own key only to the provider and endpoint it is bound to, in a header,
  never in the URL (`tests/ask_ai.test.ts`).
- Key checks prove what they claim: an OpenRouter key is checked at `/key` (its `/models` list is
  public and answers any key), and a management key, which cannot answer, is refused. A probe that
  cannot read a model list says "Key accepted", never "Key verified" (D21).
- A provider's error body can quote the request back (bookmark titles), so at most 300 characters
  of it reach an error message, and it is shown only to the user who sent it; out-of-credit
  errors are recognised from the body and then replaced by fixed text.
- The two Workers run on a Cloudflare account shared with the owner's other projects. Their
  custom domains (`bookmarks-connector.palworks.ai`, `bookmarks-feedback.palworks.ai`) were
  attached as hostnames on these two Workers only; nothing else on the account changes with them
  (D22, AGENTS rule 25).

## Trust boundaries

| Boundary | Rule |
|---|---|
| Content script (runs inside third-party pages) | Cannot send the worker any message: the worker answers only this extension's own pages (`src/lib/sender.ts`, F5). The content script is injected only for a capture and never sends messages. No `externally_connectable` and no `web_accessible_resources`, so sites and other extensions cannot reach the worker or frame its pages. |
| What an AI reads (bookmark titles, links, folder names) | Untrusted: a title can carry instructions (prompt injection). Model replies are shown as plain text only (no HTML, no markdown, no images), links shown from AI rows are http(s) only and open in a new tab without the opener, no AI change can set a bookmark's URL, and nothing an AI does opens or captures a page. In Ask AI, sending to Trash waits for the user's OK (D24); everything else applies with Undo and Redo. |
| Extension pages writing metadata | `META_PATCH` keeps only allowlisted fields with valid values (rating 1 to 5, times not in the future, tags capped at 20 of 50 characters, known capture statuses); ids at most 2,048 characters. |
| Folder prefs | Only the worker writes them; ids must be existing, non-root folders; colours from a fixed list. |
| Deletes made outside the extension | Recorded from Chrome's own `onRemoved` events only (no message can create an external entry); policy-managed bookmarks are not kept. |
| Incognito worker (split mode) | Trash is read-only there; mutations are rejected. |
| Backup and settings files (user-supplied, possibly shared) | Only allowlisted settings with valid types are applied; metadata records pass the same allowlist as `META_PATCH` and never overwrite a stored rating or tags; folder prefs apply only to one exact title path (at most 2,000 items, 64-part paths); custom endpoints must be http(s) without credentials, query or fragment; provider and endpoint are never changed while a key is saved; only `data:` image URLs are decoded (no fetches to arbitrary URLs). |
| Restore destination | Never chosen across storage scopes (local vs synced) without the user picking it. |
| Managed bookmarks | Never deleted; a request that includes one is rejected as a whole. |
| Extension pages | CSP `script-src 'self'; object-src 'self'`; no remote code. |
| AI change sets (pasted, from a file, from Ask AI, Claude, ChatGPT or a coding agent) | Untrusted input: parsed with limits (1 MB, 200 changes, 1,000 items removed), control and bidi characters stripped, rendered as text; validated in full by simulation against the live tree, and one bad change refuses the whole set; ids outside the shared folders or inside hidden ones read as unknown, and a folder that holds a hidden folder cannot be sent to Trash (review of 2026-11-10). Pasted sets and connections in `propose` mode wait for the user's Apply (Trash contents frozen at approval); Ask AI and connections in `change` mode (the default since D20) apply at once, journaled, with removals going to Trash. Undo never overwrites a newer change; a connection may undo only its own sets. |
| Ask AI (extension page, the user's provider) | Tool calls arrive as `AGENT_TOOL` from extension pages in regular windows only; scope is every folder not hidden from search; at most 12 tool calls per message; tool results cut at 24,000 characters. Bookmark titles and links are untrusted text that could try to steer the model (prompt injection); the worst case is a change the user can undo in one click, inside the folders in scope. |
| Online connector (public endpoint, D20) | See "Online connector threat model" below. |
| Coding-agent bridge (local programs of the same OS user) | Optional `nativeMessaging`, requested from a click. The host listens on a 0600 Unix socket in a 0700 folder it checks with `lstat` (no links, same owner) and keeps no state. Pairing needs a 6-digit code shown only in the extension, bound to the client's random pairing id, 2-minute life, 3 tries, 5 prompts an hour, blockable per name. Tokens are 32 random bytes; only their SHA-256 is stored; they never appear in output, errors or logs. Each agent reads only the folders the user ticks (never hidden ones) and may change only in the mode the user chose (`read`, `propose` or `change`). At most 4 connections and 64 KB per request. The regular worker only. |
| Feedback relay (public, unauthenticated endpoint) | JSON only, 16 KB body, 4,000-character message, plausible-email check, honeypot; accepts only our extension's origins (a web page from any other origin gets 403); per-network burst and hourly limits plus a daily global cap, counted atomically in a Durable Object that refuses when it cannot count (an IPv6 sender counts as its /64); a failed send gives the allowance back; generic errors that never echo the provider's response; stores only rate-limit counters keyed by an HMAC of the network, deleted within 26 hours. |
| Usage statistics relay (`POST /events`, same Worker, D27) | Only our extension's origins; 8 KB body, 20 events a batch, a per-network burst limit (`EVENTS_BURST`); every name, key and value checked again (identifiers, numbers, booleans, short words without spaces or slashes), anything else dropped; the install id must be a UUID. Forwards the country only, never the IP; PostHog gets no person profiles and no GeoIP. Stores nothing. A forged batch can at worst add fake counts, never read anything. |

## Online connector threat model (D20)

Claude and ChatGPT reach the user's browser through our Worker (`connector/`), which relays MCP
calls over a WebSocket the browser opened. What protects each step:

**Table S1: Connector threats and controls**

| Threat | Control |
|---|---|
| Someone learns the connector address `<origin>/mcp/<linkId>` | The link id is not a secret, but it is 16 random bytes and not guessable. Knowing it gives nothing without a token: MCP calls without a valid bearer token get 401. |
| Someone guesses the sign-in code | The 6-digit code shows only in the extension, changes every 10 minutes, and ends after 5 wrong tries; the Worker allows 4 authorization attempts a minute per network (start and code entry both count). |
| Another site posts the authorize form, or changes its OAuth fields | Posts from another origin are refused (`Origin`, `Sec-Fetch-Site`); the fields carrying the OAuth parameters are HMAC-signed page state that expires; the page has no script and a CSP of `default-src 'none'; style-src 'self'; form-action 'self' <app origin>; frame-ancestors 'none'; base-uri 'none'`. |
| A stolen authorization code | One-time, stored under its hash, valid for 2 minutes, bound to the client id and redirect URI, and exchanged only with the PKCE S256 verifier. |
| Forged or altered client registrations | Registration is stateless: the client id is an HMAC-signed record of the redirect URIs and client name, so it cannot be changed; redirect URIs must be https (http only on loopback) without fragments or user info. Rotating `CLIENT_ID_SECRET` invalidates every client id. |
| A leaked token | The token lives only in the AI app (as its access token) and, as a SHA-256 hash, in the extension; the Worker holds it only inside a 2-minute authorization code. Removing the connection in the extension revokes it; "Make a new address" also replaces the link secret and removes every online connection. |
| Someone else's browser answering for a link | The browser's first frame carries the link secret; the Durable Object stores its SHA-256 on first use and refuses a different secret later. |
| The relay reading or keeping bookmark data | Requests and answers pass through in memory only. The Worker stores no bookmark data and never logs tokens, secrets, codes or request and response bodies; its one log line is an error name with the path, link ids masked. |
| Flooding | 64 KB per request (413), 30 s per tool call, 60 MCP requests a minute per link for tokens the browser accepted and 20 for any other token (429); a refused token gets 401 for 10 minutes without reaching the browser. |
| What a connected app may do | Only the folders and mode chosen on the code card (default: every top-level folder except hidden ones, mode `change`), changeable or removable at any time on the Connect page. |

Real Claude and ChatGPT clients against the deployed Worker are not covered by automated tests;
they passed a manual run on 2026-11-10 (connect, read, change and Undo).

## Permissions

See PRIVACY_DETAILS.md for the justification of each permission. New permissions must not add an
install warning (DECISIONS.md D3). The optional `history` permission is requested only from a
click and checked with `chrome.permissions.contains` before every use; it was verified to add
no install warning (Chrome 156, 2026-11-08). The optional `nativeMessaging` permission (1.7.0)
follows the same rule; `management.getPermissionWarningsByManifest` returned the same warnings with
and without it (2026-11-09). The online connector (D20) adds no permission: it uses a WebSocket
from the service worker under the existing `<all_urls>` host permission.

## Review of the D20 changes (2026-11-10)

**Table S2: Findings and fixes**

| # | Finding | Fix |
|---|---|---|
| 1 | Sending a shared folder to Trash also removed a folder inside it that is hidden from search | Refused, with the same reason as an unknown id |
| 2 | Ask AI history cut at a fixed length could split a tool call from its result, so long chats failed | History is cut only at a user message |
| 3 | The standing sign-in code had no hourly cap, and a new code reset the folders the user chose | At most 10 new codes an hour; the choice is kept |
| 4 | A bad authorize request redirected straight to any registered address (open redirect) | Shown on the page instead |
| 5 | The worker start and the retry alarm could open two sockets; switching off mid-connect left one serving | One connect at a time; a switch-off cancels it |
| 6 | A batch of 20 tool calls counted as one request against the 60 a minute limit | One tool call per request |
| 7 | A replaced socket could be chosen for a relay while closing [Unverified that the runtime lists it] | Marked as not live before it closes |

## Review of every AI surface (2026-11-10)

Read-only review (OWASP, STRIDE, LLM and agent risks, supply chain) of Ask AI, the shared tools,
the online connector, the coding-agent helper, the content script and the manifest. No path was
found from model output, tool results, bookmark titles or URLs to running code or opening a page.

**Table S3: Findings and their state**

| # | Severity | Finding | State |
|---|---|---|---|
| F1 | Medium | A bookmark title can steer Ask AI (prompt injection); "ask before more than 50 to Trash" was only an instruction to the model | **Fixed** (D24): any change set that sends to Trash waits for the user's OK in the chat; the rest applies with Undo and Redo |
| F2 | Medium | Connector defaults: full links with query strings, tokens that never expire | **Fixed**: new remote connections hide query strings by default; a remote connection unused for 90 days is removed (1.8.1, ROADMAP row 24) |
| F3 | Medium | Whoever controls the Cloudflare account can capture connector tokens | **Accepted** (owner, 2026-11-11): the Workers stay on the shared account. Keep two-step sign-in on it and give API tokens only the permissions a job needs |
| F4 | Low | A shared backup file could set AI mode, provider and server when no key was saved | **Fixed**: those three are never taken from a file; the panel names a custom server's address |
| F5 | Low | The worker answered some messages (Auto-Tag, Smart Search, batch capture) from any sender; content scripts could read stored data | **Fixed**: only the extension's own pages are answered; storage access set to trusted contexts [Unverified that every supported Chrome applies it to storage.local] |
| F6 | Low | Someone who knows a link id can use up its per-minute budget or the sign-in tries | **Fixed** (connector deploy, 2026-11-11): tokens not yet accepted by the browser have their own 20 a minute; refused tokens are answered 401 for 10 minutes without reaching the browser |
| F7 | Low | The helper installer trusts any unpacked extension with the product's name | **Fixed** (D25): install asks once per copy in a terminal, allows nothing without one, and never allows a copy in a folder another user owns or can change |
| F8 | Low | A token worked on either transport | **Fixed**: bound to the transport it was issued on |
| F9 | Low | A custom server over plain http to the internet would send the key in clear text | **Fixed**: http only for this computer and the local network |
| F10 | Info | Ask AI sends full links (with query strings) to the user's provider | **Open, by design**: disclosed in the panel; the AI uses links to sort |
| F11 | Info | The helper's update instruction used `@latest` | **Fixed**: pinned to the package version |

## Pre-release audit of 1.8.0 (2026-11-11)

A full read of the service worker, storage, UI, the AI stack, the helper, the connector and both
relays before 1.8.0. Findings that touch security or trust:

**Table S4: Audit findings and their state**

| # | Severity | Finding | State |
|---|---|---|---|
| F12 | High | Ask AI's Trash check read a string change set with plain JSON parsing, while the import also accepts JSON in a code fence or after a sentence, so a prompt-injected set could reach Trash without the user's click (rule 26) | **Fixed**: the check uses the import's own parser and treats anything unreadable as needing approval; tests cover fenced and prefixed sets |
| F13 | Low | "Hide query strings" kept a user name and password written into a link before its host | **Fixed**: they are removed too |
| F14 | Low | The copy-and-paste export included a ticked folder whose parent was hidden from search | **Fixed**: same ancestor check as the connector's scope |
| F15 | Low | The connector failed requests in flight on a reconnect, so an AI app could retry a change that had been applied | **Fixed** (connector deploy): requests wait 5 s for the browser to come back and are answered on the new socket |
| F16 | Low | The connector's limiter counted every IPv4-mapped IPv6 address as one network | **Fixed** (connector deploy): counted as the IPv4 address, as in the feedback relay |
| F17 | Info | In split incognito, the two service workers each keep their own write queue for `meta_*`, so a rating and an Auto-Tag on the same link at the same moment in both can lose one write | **Fixed** (1.8.1): each metadata write is read back and merged again if the other worker wrote in between |

