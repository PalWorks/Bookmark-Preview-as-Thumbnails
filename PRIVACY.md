# Privacy Policy for Bookmarks Thumbnails

**Last Updated:** 2026-06-03

Bookmarks Thumbnails is designed to be privacy-respecting. This policy explains
exactly what data the extension handles and where it goes.

## What the extension stores (locally)

All of the following stays **on your device** — it is never sent to us (we run no
servers):

1. **Thumbnails & metadata.** Screenshots captured for your bookmarks, plus their
   titles, status and timestamps, are stored locally in `chrome.storage.local`.
2. **Settings.** Your preferences (theme, capture delay, etc.) are stored in
   `chrome.storage.sync` (synced by your browser across your own signed-in
   devices, per Chrome's normal sync).
3. **Optional disk folder.** If you use "Connect a Folder" (File System Access
   API), thumbnails are also written to the directory you explicitly choose. The
   extension accesses no other files.
4. **AI API keys (optional).** If you enable a cloud AI provider, your API key is
   stored locally (obfuscated at rest) and is sent **only** to the provider you
   selected, solely to authenticate your own requests. It is never sent to us.

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

If you never enable a cloud AI provider, the extension makes no third-party
network requests (it only loads the pages you bookmark, in order to screenshot
them).

## Permissions

- **bookmarks** — read your bookmarks to display them and associate thumbnails.
- **tabs / activeTab / scripting / webNavigation** — load and capture bookmarked
  pages to generate thumbnails.
- **storage / unlimitedStorage** — store thumbnails, metadata, and settings locally.
- **host permissions (`<all_urls>`)** — capture screenshots of any site you have
  bookmarked, and (only if you enable cloud AI) send requests to your chosen
  provider's API endpoint.

## Data deletion

- Remove individual thumbnails in the extension, or
- Uninstall the extension (clears its local data), or
- Clear the browser's "Hosted App Data" for the extension.

Your stored API key is removed when you clear it in AI Settings or uninstall.

## Contact

Questions or requests: **support@palworks.ai** — or open an issue at
<https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/issues>.
