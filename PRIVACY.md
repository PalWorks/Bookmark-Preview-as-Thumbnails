# Privacy Policy for Bookmarks Thumbnails

**Last Updated:** 2026-11-10T11:40:58+00:00

Bookmarks Thumbnails is designed to be privacy-respecting. This policy explains
exactly what data the extension handles and where it goes.

## What the extension stores (locally)

All of the following stays **on your device**; it is never stored by us. We run two
small servers: the feedback relay described under "Feedback you send", which receives
only what you type into the feedback form, and, only if you turn it on, the connector
for Claude and ChatGPT described under "Ask AI, Claude and ChatGPT", which passes
requests through without storing them:

1. **Thumbnails & metadata.** Screenshots captured for your bookmarks, plus their
   titles, status and timestamps, are stored locally in `chrome.storage.local`.
2. **Settings.** Your preferences (theme, capture delay, etc.) are stored in
   `chrome.storage.sync` (synced by your browser across your own signed-in
   devices, per Chrome's normal sync).
3. **Optional disk folder.** If you use "Connect a Folder" (File System Access
   API), thumbnails are also written to the directory you explicitly choose. The
   extension accesses no other files.
4. **Trash.** When you delete a bookmark or folder in the extension, a copy of its
   titles, links, folder location and dates is kept in `chrome.storage.local` for
   30 days so you can restore it. From 1.4.0 the same applies to bookmarks deleted
   outside the extension (in Chrome's bookmark manager, by sync, or on your other
   devices) while Chrome is open on this computer; you can turn this off at the top
   of the Trash view, and what is already kept stays until it expires or you empty
   Trash. After 30 days, or when you empty Trash, the copy is removed together with
   cached previews that no other bookmark uses. Preview files already saved to a
   folder you connected on disk stay there.
5. **Your organisation.** Folder colours and "hidden from search" choices, your
   ratings, and when you last opened a bookmark from the extension are stored in
   `chrome.storage.local` on this device (1.4.0). They are included in backups you
   export.
6. **Site icons.** Bookmarks without a preview show their site icon from Chrome's
   own local favicon cache. This is read on your device; no request goes to the
   site or to us.
7. **AI API keys (optional).** If you enable a cloud AI provider, your API key is
   stored locally (obfuscated at rest) and is sent **only** to the provider you
   selected, solely to authenticate your own requests. It is never sent to us.
   The key is tied to the provider (and, for a custom or local server, the server
   address) you entered it for. If that provider or address changes without you
   re-entering the key, the extension does not send the key and asks for it again.

## The optional AI features (what leaves your device)

The AI features (Auto-Tag and Smart Search) are **opt-in** and you choose the
engine:

- **Chrome Built-in AI (Gemini Nano) — on-device.** Runs entirely locally. **No
  data leaves your device.** This is the default.
- **A cloud provider you configure** (e.g. OpenAI, Anthropic, Google Gemini,
  Groq, Mistral, etc.) **or a local server** (Ollama / LM Studio). When you use a
  cloud provider, the extension sends the following to **that provider only**, to
  generate tags or search results:
  - **Auto-Tag:** each bookmark's **title, domain, and URL path**.
  - **Smart Search:** the **titles and URLs** of bookmarks in the folder you are
    searching, plus your search query.

  No page contents, browsing history, cookies, or data from non-bookmarked sites
  are sent. Your data is handled by the chosen provider under **their** privacy
  policy and terms. We do not receive, store, or sell any of it.

If you never enable a cloud AI provider, never use Ask AI, never turn on the Claude and
ChatGPT connector, never send feedback and never pair a coding agent, the extension makes
no third-party network requests (it only loads the pages you bookmark, in
order to screenshot them).

## Ask AI, Claude and ChatGPT, and coding agents (optional, from 1.7.0)

- **Ask AI.** If you open Ask AI and send a message, the extension sends your message
  and what the AI asks to read (bookmark and folder titles, links, folder paths, tags,
  ratings and when you last opened a bookmark from the extension) to **the provider you
  chose in Provider Settings (AI Tools; AI Settings in 1.7.0 and earlier), only**, under your own key, so it can answer and make the changes
  you ask for. It can read every folder except those hidden from search. The panel names
  the provider and model before you send. The provider handles this data under its own
  policy. The conversation is kept in the browser's session storage and is gone when the
  browser closes. We never receive it.
- **Claude and ChatGPT (online connector).** If you turn on "Let Claude and ChatGPT
  organise my bookmarks" (menu > AI Tools > Connect Claude or ChatGPT; in 1.7.0, menu > Connect Claude or ChatGPT), the extension keeps a
  connection to our relay (a Cloudflare Worker run by us at bookmarks-connector.palworks.ai; 1.7.0 reaches the same Worker at its workers.dev address) while Chrome is open. When you
  ask Claude or ChatGPT about your bookmarks, their servers send the request through our
  relay to your browser, and your browser's answer (titles, links, folder paths, tags and
  ratings from the folders you chose) goes back through the relay to them. The relay
  passes this data through in memory and **stores none of it**: it keeps only a one-way
  hash of your link's secret, a per-minute request counter, one-time sign-in codes for at
  most 2 minutes, and short-lived per-network counters named by a keyed one-way hash of
  the network address (never the address). It does not log what passes through. Claude
  and ChatGPT handle what they receive under Anthropic's and OpenAI's own policies. You
  choose which folders an app may see and whether it may read only, suggest changes for
  you to review, or change with Undo. Removing a connection, switching off, or "Make a new
  address" stops it.
- **Changes an AI makes** apply at once (unless you chose review first) and can be undone
  with one click; removed bookmarks go to the extension's Trash.
- **Copy and paste ("Other ways").** You tick the folders to share (none are ticked at first).
  The extension builds a text of their titles, links, tags and ratings that you copy
  or save, and you decide which AI to give it to; that AI's provider handles it under
  its own policy. You can remove the part of links after "?". Folders hidden from
  search are never included. The extension itself sends nothing anywhere.
- **Coding agents.** If you turn on "Connect coding agents" (menu > Connect Claude or
  ChatGPT > Coding agents on this computer), Chrome asks for the
  optional "communicate with cooperating native applications" permission. A helper
  program on your computer then relays requests from coding agents you pair (with a
  6-digit code shown only in the extension). A paired agent can read only the folders
  you tick for it, and it may pass what it reads to the AI service it uses. You choose
  whether it may read only, suggest changes for you to review, or change with Undo.
  Pairing tokens are stored as one-way hashes. Turning the switch off removes the
  permission.
- **Change sets** you import or receive, and the record that lets you undo them, are
  kept in `chrome.storage.local` for 30 days. They are not included in backups, and
  neither are your connections or the connector address.

## Feedback you send (optional)

**Settings > Submit Feedback** opens a form inside the extension. Nothing is sent
until you press **Send feedback**. Then the extension sends, to our feedback relay
(a Cloudflare Worker run by us at bookmarks-feedback.palworks.ai; 1.6.0 and 1.7.0 reach the same Worker at its workers.dev address), which emails it to support@palworks.ai through our
email provider (Resend):

- the topic you picked and the **message you typed**;
- the **email address**, only if you typed one, so we can reply;
- unless you untick "Include technical details": the extension version, the browser
  build and operating system (for example "Chrome/156 on Linux"), how many bookmarks
  and folders you have, and whether you use grid or list view. **No bookmark titles,
  links, folder names or tags.**

The relay stores no message content. To limit abuse it keeps short-lived counters per
network, named by a keyed one-way hash of the network address and never the address itself;
they expire within 26 hours. We use what you send only to answer you and improve the
extension, and we never sell it. To have a message deleted, write to
support@palworks.ai.

## Permissions

- **bookmarks** — read your bookmarks to display them and associate thumbnails.
- **tabs / activeTab / scripting / webNavigation** — load and capture bookmarked
  pages to generate thumbnails.
- **storage / unlimitedStorage** — store thumbnails, metadata, Trash, and settings locally.
- **favicon** — show a bookmark's site icon from Chrome's local favicon cache when it has no preview.
- **alarms** — run the daily clean-up that removes Trash items older than 30 days.
- **history (optional, 1.4.0)** — asked for only when you turn on the Visits or Last
  visited column in list view. The extension then reads the visit count and last visit
  of the bookmarks on screen from Chrome's history, on your device, and stores nothing.
  Turning those columns off gives the permission back; you can also remove it in
  `chrome://extensions`.
- **nativeMessaging (optional, 1.7.0)** — asked for only when you turn on "Connect
  coding agents", so the extension can talk to the helper program you installed for coding
  agents. Turning the switch off gives the permission back.
- **host permissions (`<all_urls>`)** — capture screenshots of any site you have
  bookmarked, and (only if you enable cloud AI or Ask AI) send requests to your chosen
  provider's API endpoint. The Claude and ChatGPT connector needs no extra permission.

## Data deletion

- Delete bookmarks in the extension and then **Empty Trash** (removes the Trash copy
  and any cached preview no other bookmark uses), or wait 30 days, or
- Uninstall the extension (clears its local data), or
- Clear the browser's "Hosted App Data" for the extension.

Your stored API key is removed when you clear it in Provider Settings (AI Settings in 1.7.0 and earlier) or uninstall. Backup
and **Export Settings** files never contain the API key or its encryption key.

## Contact

Questions or requests: **support@palworks.ai** — or open an issue at
<https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/issues>.
