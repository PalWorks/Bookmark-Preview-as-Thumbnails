# bookmarks-thumbnails-mcp

Let a coding agent on your computer (Claude Code, Cursor, VS Code) read the bookmark folders you
choose in Chrome and propose changes. Nothing changes until you review and apply them in the
[Visual Bookmark Manager with Thumbnail Previews](https://chromewebstore.google.com/detail/bookmarks-as-thumbnails/eedekafhclngkhhkcocblnllkbodgnhj)
extension, and one click undoes them.

Linux and macOS, Google Chrome, Node 22 or newer. Windows, Edge and Brave are planned.

## Quick start

1. In Chrome, open the extension: **Settings > Coding agents**, turn on **Connect coding agents**
   and allow the permission Chrome asks for.
2. Add the helper to your agent. Claude Code:

   ```bash
   claude mcp add bookmarks -- npx -y bookmarks-thumbnails-mcp@1.7.0
   ```

   Cursor or VS Code (`mcp.json`):

   ```json
   { "mcpServers": { "bookmarks": { "command": "npx", "args": ["-y", "bookmarks-thumbnails-mcp@1.7.0"] } } }
   ```

   The first run installs the browser helper for you. To do it by hand:
   `npx bookmarks-thumbnails-mcp@1.7.0 install`, then turn the switch off and on.
3. Ask the agent: **"pair with my bookmarks"**. A 6-digit code appears in Settings > Coding
   agents. Tick the folders it may read, then give the agent the code.
4. To let it suggest changes, choose **Read and propose** for it in the same place. Its
   proposals wait in **AI changes** (the toolbar icon shows a count).

## Pairing walkthrough

```text
you    > pair with my bookmarks
agent  : (calls pair) The extension shows a code. What is it?
you    > 482 913
agent  : (calls pair with the code) Paired. No folders are shared yet ...
```

Folders hidden from search are never offered. You can tick **Remove the part of links after
"?"** so tracking or session details in links are not shared.

## Troubleshooting

Run `npx bookmarks-thumbnails-mcp doctor`:

```text
OK   node: Node 22.18.0 (needs 22 or newer)
OK   chrome: host manifest: ~/.config/google-chrome/NativeMessagingHosts/com.palworks.bookmarks_thumbnails.json
OK   chrome: launcher: ~/.local/share/bookmarks-thumbnails/host-chrome.sh
FAIL browser connected: no browser profile has the switch on
     Fix: In Chrome: extension > Settings > Coding agents > Connect coding agents.
```

| Symptom | Fix |
|---|---|
| The extension says "Helper app not found" | Run `npx bookmarks-thumbnails-mcp install`, then turn the switch off and on. |
| `NOT_CONNECTED` | Turn on Settings > Coding agents in the Chrome profile you paired with. |
| `NOT_PAIRED` after it worked | The agent was removed in Settings, or the extension's data was cleared. Pair again. |
| `AMBIGUOUS_TARGET` | Several Chrome profiles have the switch on; pass `--profile`. |
| `doctor --last-error` | Prints the helper's last error from its log. |
| Chrome from Flatpak or Snap | Not supported; use Chrome from google.com. |

Every error has a code, a one-line fix and a link: [docs/bridge.md](https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/blob/main/docs/bridge.md).

## CLI

```bash
npx bookmarks-thumbnails-mcp search "invoice"        # same names as the MCP tools
npx bookmarks-thumbnails-mcp list-folders --json
npx bookmarks-thumbnails-mcp propose changes.json --key tidy-1
npx bookmarks-thumbnails-mcp uninstall
```

## Upgrading

Change the version in your MCP configuration and run `npx bookmarks-thumbnails-mcp@<new> install`.
Chrome uses the new helper from its next start.

## Licence

AGPL-3.0-only, with a commercial licence available
([COMMERCIAL-LICENSE.md](https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/blob/main/COMMERCIAL-LICENSE.md)).
Source: [github.com/PalWorks/Bookmark-Preview-as-Thumbnails/tree/main/bridge](https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/tree/main/bridge).
