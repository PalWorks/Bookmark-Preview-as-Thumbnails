# Chrome Web Store Privacy Details

_Last updated: 2026-11-09T16:01:20+00:00 (1.6.0: PII and personal communications for the feedback form; Location unticked; planned changes)._

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
| **webNavigation** | Detect when a page finishes loading during batch capture so the screenshot reflects the rendered page. |
| **Host Permissions** (`<all_urls>`) | Capture screenshots of any bookmarked site, and, only if the user enables a cloud AI provider, send requests to that provider's API endpoint. The feedback form (1.6.0) posts to our own relay; that request needs no extra permission. |

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
- **Web history / website data** — bookmark **titles and URLs** are sent to a
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

## 5. Planned changes that will need this page

The approved Agent changes plan (docs/designs/agent-bridge.md) adds no permission in
Stage 1. Its Stage 2 would add optional `nativeMessaging` with a justification here and a
check of the User Data policy first. Nothing to change until that ships.

## 6. Privacy Policy

> Host PRIVACY.md (this repo) at a public URL and enter it in the dashboard, e.g.
> `https://palworks.github.io/Bookmark-Preview-as-Thumbnails/#privacy`
> (Confirm this page is actually live and serves the current PRIVACY.md content.)
