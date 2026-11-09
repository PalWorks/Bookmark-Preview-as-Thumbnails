# Privacy Policy for Bookmarks Thumbnails

**Last Updated:** 2026-11-09T16:00:59+00:00

Bookmarks Thumbnails is designed to be privacy-respecting. This policy explains
exactly what data the extension handles and where it goes.

## What the extension stores (locally)

All of the following stays **on your device**; it is never sent to us. The only
server we run is the feedback relay described under "Feedback you send", and it
receives only what you type into the feedback form:

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

If you never enable a cloud AI provider and never send feedback, the extension
makes no third-party network requests (it only loads the pages you bookmark, in
order to screenshot them).

## Feedback you send (optional)

**Settings > Submit Feedback** opens a form inside the extension. Nothing is sent
until you press **Send feedback**. Then the extension sends, to our feedback relay
(a Cloudflare Worker run by us), which emails it to support@palworks.ai through our
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
- **host permissions (`<all_urls>`)** — capture screenshots of any site you have
  bookmarked, and (only if you enable cloud AI) send requests to your chosen
  provider's API endpoint.

## Data deletion

- Delete bookmarks in the extension and then **Empty Trash** (removes the Trash copy
  and any cached preview no other bookmark uses), or wait 30 days, or
- Uninstall the extension (clears its local data), or
- Clear the browser's "Hosted App Data" for the extension.

Your stored API key is removed when you clear it in AI Settings or uninstall. Backup
and **Export Settings** files never contain the API key or its encryption key.

## Contact

Questions or requests: **support@palworks.ai** — or open an issue at
<https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/issues>.
