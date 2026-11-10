# Chrome Web Store Privacy Details

_Last updated: 2026-11-10T11:40:58+00:00 (AI Tools menu path for the next release; 1.7.0 text as submitted is unchanged in substance)._

Use the following to fill out the "Privacy" tab in the Developer Dashboard. These
must match `public/manifest.json` exactly.

## 1. Single Purpose

> To provide a visual preview of bookmarks as thumbnails, making it easier to
> recognize and organize saved pages. (Optional, opt-in AI features help tag and
> search those bookmarks.)

## 2. Permission Justifications

These are the permissions actually declared in the manifest:

| Permission | Justification |
| :--- | :--- |
| **storage** | Store generated thumbnails, metadata, and user preferences locally. |
| **tabs** | Load bookmarked pages in a background window to capture a thumbnail. |
| **activeTab** | Capture the visible area of the active tab when the user triggers a preview. |
| **scripting** | Inject the capture helper into background tabs (standard capture only works for the active tab). |
| **bookmarks** | Read bookmarks to display them and associate thumbnails with URLs. |
| **unlimitedStorage** | Store many thumbnail images without hitting the standard quota. |
| **favicon** | Show a bookmark's site icon from Chrome's local favicon cache when no thumbnail exists yet. No network request. |
| **alarms** | Run a daily local clean-up that permanently removes Trash items older than 30 days. |
| **history** (optional) | Requested only when the user turns on the Visits or Last visited column in list view. Reads visit count and last visit time for the bookmarks on screen with `chrome.history.getVisits`; nothing is stored or sent anywhere. Optional permissions add no install warning. |
| **nativeMessaging** (optional, 1.7.0) | Requested only when the user turns on "Connect coding agents" (menu > AI Tools > Connect Claude or ChatGPT > Coding agents on this computer; in 1.7.0: menu > Connect Claude or ChatGPT). Lets the extension exchange messages with a helper program the user installed (`bookmarks-thumbnails-mcp`), which relays requests from coding agents the user pairs. Agents read only folders the user ticks and change bookmarks only in the mode the user chose (read only, review first, or change with one-click Undo). Optional permissions add no install warning (checked with `management.getPermissionWarningsByManifest`, Chrome, 2026-11-09). |
| **webNavigation** | Detect when a page finishes loading during batch capture so the screenshot reflects the rendered page. |
| **Host Permissions** (`<all_urls>`) | Capture screenshots of any bookmarked site, and, only if the user enables a cloud AI provider (Auto-Tag, Smart Search, Ask AI), send requests to that provider's API endpoint. The feedback form (1.6.0) posts to our own relay, and the optional Claude and ChatGPT connector (1.7.0) keeps a WebSocket to our own connector Worker; neither needs an extra permission. |

> The extension does **not** request `downloads` or `management`. (Backup export
> uses an in-page anchor download; the in-app uninstall uses
> `management.uninstallSelf`, which does not require the `management` permission.)

## 3. Remote Code

> **NO.** No code is fetched or executed remotely. All scripts are bundled; CSP is
> `script-src 'self'; object-src 'self'`. The AI features call provider REST APIs
> for data only — they do not download or run code.

## 4. Data Usage — IMPORTANT (updated for the AI features)

The extension now has optional AI features that can transmit bookmark data to a
third-party provider. Disclose this accurately:

**Data collected / used:**
- **Website content** — screenshots of bookmarked pages (stored locally only).
- **Deleted bookmarks** — titles, URLs and folder locations of bookmarks deleted in the
  extension, kept locally for 30 days for Restore (never transmitted).
- **Website content (hyperlinks)** — bookmark **titles and URLs** are sent to a
  third-party AI provider **only when the user enables a cloud AI provider** for
  Auto-Tag or Smart Search. With the default on-device engine (Chrome Built-in AI)
  nothing is transmitted. API keys are stored locally and sent only to the user's
  chosen provider for authentication; a key is bound to its provider and custom
  endpoint address and is not sent if either changes.

- **Personally identifiable information** (ticked since 1.6.0): the optional reply
  address a user types into the feedback form, sent to our relay only when they press
  Send and emailed to support@palworks.ai.
- **Personal communications** (ticked since 1.6.0): the feedback message itself, same
  path. The relay stores no message content.
- **Location** stays unticked: the relay keeps only an HMAC of the sender's network
  address as a rate-limit counter for at most 26 hours, never the address
  [Inference: judged on 2026-11-09 when 1.6.0 was submitted; recheck if the dashboard
  wording changes].

**Certifications — read carefully before checking:**
- "I do not sell or transfer user data to third parties" — **transferring bookmark
  titles/URLs to the user's chosen AI provider is a transfer.** It is for the
  user-requested feature and disclosed in the privacy policy, but you should
  reflect this honestly in the dashboard (i.e. do not blanket-certify "no transfer"
  if you ship the cloud AI feature; the transfer is to a service provider for the
  user's own requested functionality).
- "I do not use or transfer user data for purposes unrelated to the single
  purpose" — OK (the transfer is for tagging/search, the stated purpose).
- "I do not use or transfer user data to determine creditworthiness / lending" — OK.

## 4a. Usage statistics (1.8.0, D27)

From 1.8.0 the extension sends anonymous usage statistics (on by default, off in Settings >
Share usage statistics) to our relay, which passes them to Google Analytics and PostHog. In
the dashboard's Privacy practices tick **User activity** (feature use events) and keep the
certifications true: the data is not sold, is used only to improve the extension, and is not
used for credit or lending. What is sent: a random install id, a session number, the
version, feature event names with numbers, on/off values or short words, and the country.
Never links, titles, folder names, searches, chat text or keys. The relay drops anything else.

## 5. Ask AI, Claude and ChatGPT, and coding agents (1.7.0, D20)

What changes from 1.6.0:

- **Ask AI** sends the user's message and the bookmark data the model asks for (titles, links,
  folder paths, tags, ratings, last-opened times) to the user's own chosen AI provider. In the
  side panel each message also carries the open folder's path, id and item count, which the user
  can turn off. This is
  the same kind of transfer as Auto-Tag and Smart Search with a cloud provider, already declared
  under "Web history / website data" in section 4.
- **The Claude and ChatGPT connector** sends the same kind of bookmark data, from the folders the
  user picks, through **our own relay** (the `connector/` Worker) to Anthropic or OpenAI, at the
  user's request in their app. The relay stores none of it and logs no bodies; it keeps only a
  hash of the link secret, one-time sign-in codes for 2 minutes and rate counters named by an HMAC.
- **Copy and paste** and **coding agents** are unchanged in kind: the user copies an export, or a
  local program reads only the folders they tick.

Dashboard steps before submitting 1.7.0:

- **Website content** stays ticked (it covers text and hyperlinks, so bookmark titles and URLs
  sent by Ask AI and the connector). **Web history** stays unticked, as approved for 1.5.0 and
  1.6.0: the dashboard defines it as pages the user visited, and the features send saved
  bookmarks, not browsing history. (Done for 1.7.0 at 2026-11-10T06:33:36+00:00: data usage unchanged,
  `nativeMessaging` justification added.)
- **Website content**: ticked already for local screenshots; no screenshots are sent by these
  features (the tools return text only) [Inference: no change needed].
- **Personally identifiable information** and **Personal communications** stay ticked for the
  feedback form. Ask AI messages go to the user's own provider, not to us, and connector
  requests pass through without being stored [Inference: these do not add a new category;
  recheck if the dashboard asks about data "handled" rather than "collected"].
- **Certifications**: "no sale" stays true. The transfers above are to service providers the
  user chose, for the user's own requested organising, which is within the single purpose
  [Inference: keep the honest wording from section 4 rather than a blanket "no transfer"].
- **Single purpose**: consider adding "and organise them with an AI assistant you choose" to the
  optional clause in section 1 [Inference: the organising is part of the stated purpose
  "recognize and organize saved pages"].
- **Remote code**: still NO. The connector relays data only; no code is fetched.
- Privacy tab: add the `nativeMessaging` justification above; host the updated PRIVACY.md
  (website `Legal.tsx`) before submitting.

## 6. Privacy Policy

> Host PRIVACY.md (this repo) at a public URL and enter it in the dashboard, e.g.
> `https://palworks.github.io/Bookmark-Preview-as-Thumbnails/#privacy`
> (Confirm this page is actually live and serves the current PRIVACY.md content.)
