# Bookmarks as Thumbnails

**See your bookmarks as pictures, delete without fear, and find anything fast.**
A Chrome extension that turns your bookmarks into a visual grid of page previews, with a
30-day Trash, optional AI tagging and search, and AI that tidies your bookmarks for you with
one-click Undo. Your bookmarks never leave your browser unless you turn on a cloud AI provider,
connect Claude or ChatGPT, or send us feedback.

[![Extension CI](https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/actions/workflows/extension-ci.yml/badge.svg)](https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails/actions/workflows/extension-ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-install-4285F4.svg)](https://chromewebstore.google.com/detail/bookmarks-as-thumbnails/eedekafhclngkhhkcocblnllkbodgnhj)

_Last updated: 2026-11-10T11:40:58+00:00 (1.7.0 in Web Store review; on `main` for the next release: one AI Tools page, provider fixes, palworks.ai addresses)._

## Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Overview

Chrome's bookmark manager is a text list. People with hundreds of bookmarks recognise pages by
how they look, not by their titles. This extension opens a full-page view of your bookmarks as a
grid (or list) of screenshots, captured in the background, with folders, search, sorting and
filters. It is for anyone who keeps many bookmarks and wants to find and tidy them quickly.

Everything stays in your browser profile. The optional AI features run on Chrome's built-in
on-device model by default, or with your own API key. Two things talk to servers of ours: the
in-built feedback form, only when you press Send, and the Claude and ChatGPT connector, only
while you have it switched on (it relays requests and stores none of your bookmarks); see
[PRIVACY.md](PRIVACY.md).

## Features

- **Visual previews**: batch capture in a hidden window, automatic capture when you bookmark the
  page you are on, regenerate one or all, error images for pages that fail to load.
- **Site icons when there is no preview yet**, from Chrome's local favicon cache, with the domain.
- **Trash with Undo** (1.3.0): delete from a tile, a list row, the right-click menu, the Delete key
  or Duplicate Finder; undo from the toast or with Ctrl/Cmd+Z; restore from Trash for 30 days, to
  the original place or a folder you choose. Empty Trash needs a typed confirmation.
- **Recover deletes made elsewhere** (1.4.0): bookmarks deleted in Chrome's own bookmark manager,
  by sync or on your other devices land in Trash too while Chrome is open (a switch in Trash
  turns this off).
- **Select many at once** (1.4.0): a Select button, Shift+click ranges, Ctrl/Cmd+A; delete (one
  Undo), move to a folder (with Undo) or open them.
- **Undo for rename and Cut and Paste** (1.5.0): the toast offers Undo, or
  press Ctrl/Cmd+Z; it never overwrites a change made since.
- **Organise** (1.4.0): folder colours, hide utility folders from search (with "Show them" when
  matches are hidden), list view columns for date added, last opened, your 1 to 5 star rating,
  and (with Chrome's optional history permission) visits and last visit.
- **Folders like Chrome's manager**: yellow folder icons, counts that include subfolders, a
  folder panel you can hide, and a drawer on phones and narrow windows.
- **Grid and list views**, search, sort (title, domain, date added, recently opened, rating,
  most visited), filter (folders, bookmarks, AI tag).
- **AI features, opt-in**: Auto-Tag, Smart Search (natural language), Duplicate Finder (no AI
  needed). On-device Gemini Nano by default, or OpenAI, Anthropic, Google Gemini, Groq, Mistral,
  DeepSeek, xAI, Together, Cerebras, Perplexity, OpenRouter, Ollama or any OpenAI-compatible
  server with your own key. Provider rules measured in the owner's ai-provider-kit (newer OpenAI
  models, reasoning models, out-of-credit errors, retries, current default models) live in
  `src/lib/ai_provider_rules.ts`.
- **One AI Tools page** (next release): the menu's single **AI Tools** item and the top bar's Ask
  AI icon open one page with tabs: Ask AI, Provider Settings, Auto-Tag, Smart Search, Duplicate
  Finder, Connect Claude or ChatGPT, AI changes.
- **Backup**: export everything (settings and previews) or settings only; import either. Optionally
  save previews to a folder on disk.
- **Feedback from inside the extension** (1.6.0): Settings > Submit Feedback sends a
  message, with an optional reply address and optional counts-only technical details.
- **Ask AI** (1.7.0): a chat panel that uses the provider and key from Provider Settings to read and
  reorganise your bookmarks (folders, moves, renames, tags, ratings, Trash). Changes apply at once
  and each shows a card with Undo. Every folder except those hidden from search is in scope.
- **Connect Claude or ChatGPT** (1.7.0): add one address as a custom connector in Claude or a
  developer mode app in ChatGPT, sign in with a 6-digit code from the extension, then organise
  your bookmarks from those apps on any device while Chrome is open on your computer. You choose
  the folders and the mode: read only, suggest for review, or change with Undo.
- **Coding agents** (1.7.0): Claude Code, Cursor or VS Code connect through a small helper
  (`npx bookmarks-thumbnails-mcp`) with the same tools and modes.
- **AI changes** (1.7.0): every change an AI made or suggested, with one-click Undo; suggestions
  are reviewed with tick boxes and applied as one step. Without a key or connector, "Other ways:
  copy and paste" shares chosen folders as text for any AI and takes its answer back for review.
- **Light, dark and system themes**; works from 360px wide up; keyboard and screen reader support.

## Architecture

Three browser contexts, plus two small relays of ours (feedback, and the Claude and ChatGPT connector):

| Context | File | Role |
|---|---|---|
| Service worker | `src/sw.ts`, `src/sw/trash.ts`, `src/sw/folder_prefs.ts` | Message router, capture pool, AI batches, update migration, Trash coordinator and folder prefs (single writers) |
| Extension page | `index.html` → `src/popup/` | React UI; behaviour in hooks, `App.tsx` only composes |
| Content script | `src/content/capture.ts` | Page-side capture helper |
| Feedback relay (server) | `worker/` | Cloudflare Worker that emails a sent feedback form to support through Resend; holds the only key (D16) |
| Online connector (server) | `connector/` | Cloudflare Worker: remote MCP server with OAuth 2.1 that relays Claude and ChatGPT tool calls to the browser over a WebSocket; stores no bookmark data (D20) |
| Coding-agent helper (local) | `bridge/` | npm package: native host, MCP server and CLI for coding agents on the same computer |

Data lives in `chrome.storage.local` (previews `thumb_<url>`, metadata `meta_<url>`, Trash
`trash_*`, folder prefs `fpref_*`), `chrome.storage.sync` (settings) and IndexedDB (legacy previews, folder handle).
Details: [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md),
[DECISIONS.md](DECISIONS.md).

## Tech stack

React 19, TypeScript 5.9, Vite 7, lucide-react icons, plain CSS with design tokens, Chrome
Manifest V3 APIs (bookmarks, storage, tabs, scripting, webNavigation, favicon, alarms; history
as an optional permission).
Capture uses html2canvas-pro 2.5.2. The feedback relay is a Cloudflare Worker (TypeScript, a
Durable Object for rate limits); the online connector is another Worker (MCP Streamable HTTP,
OAuth 2.1 with PKCE, one Durable Object per link).
Tests: Vitest, jsdom, React Testing Library, fake-indexeddb; the relay uses Node's test runner.

## Installation

**From the Chrome Web Store**: [Bookmarks as Thumbnails](https://chromewebstore.google.com/detail/bookmarks-as-thumbnails/eedekafhclngkhhkcocblnllkbodgnhj).

**From source** (Node 22 or newer, as CI uses):

```bash
git clone https://github.com/PalWorks/Bookmark-Preview-as-Thumbnails.git
cd Bookmark-Preview-as-Thumbnails
npm ci
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select
`dist/`.

## Configuration

There are no environment variables. Everything is set in the extension:

| Setting | Where | Stored in |
|---|---|---|
| Theme, folder panel | Top bar | `chrome.storage.sync` |
| Capture delay, active-tab capture, incognito window | Settings menu → Generate Preview settings | `chrome.storage.sync` |
| List view columns | List view, Columns | `chrome.storage.sync` |
| Keep deletes made outside the extension | Trash view, top switch | `chrome.storage.sync` |
| Folder colour, hidden from search | Folder's More actions menu | `chrome.storage.local` (this device; included in exports by folder path) |
| AI engine, provider, model, server address, preferred tags | AI Tools → Provider Settings, Auto-Tag | `chrome.storage.sync` |
| AI API key | AI Tools → Provider Settings | `chrome.storage.local`, encrypted, bound to its provider |
| Storage folder for previews | Settings menu → Choose storage folder | IndexedDB (folder handle) |
| Claude and ChatGPT switch, connector address | AI Tools → Connect Claude or ChatGPT | `chrome.storage.local` (`connector_link`; never in backups) |
| Folders and mode per connection | AI Tools → Connect Claude or ChatGPT | `chrome.storage.local` (`bridge_clients`; never in backups) |

## Usage

1. Click the extension icon; the manager opens in a tab.
2. Pick a folder on the left (the menu icon at the top left shows or hides the folder panel). Press the play button to capture
   previews for the folder; Shift+click recaptures all, Ctrl+click retries failed ones.
3. Click a tile to open the page. Use the trash icon to delete it; **Undo** brings it back.
4. **Trash** (sidebar or settings menu) lists deletions from the last 30 days. **Restore**,
   **Restore to...**, or **Empty Trash** (type EMPTY).
5. **Select** (top bar) picks several items: Shift+click a second checkbox for a range, Ctrl/Cmd+A
   for all; then **Move to...**, **Delete** or **Open**.
6. A folder's **More actions** menu has **Colour...** and **Hide from search**.
7. In list view, **Columns** chooses Added, Opened, Rating, Visits and Last visited; click
   **Rate** to give a link 1 to 5 stars.
8. **AI Tools** (menu, or the Ask AI icon in the top bar) opens one page with tabs. **Provider
   Settings** holds the provider and key; **Auto-Tag**, **Smart Search** and **Duplicate Finder**
   turn those features on.
9. **Ask AI** (first tab) is the chat: say what to change, and use **Undo** on any change card.
   **AI changes** (last tab) lists everything an AI changed or suggested, with Undo.
10. **Connect Claude or ChatGPT** (AI Tools tab): turn on "Let Claude and ChatGPT organise my bookmarks",
   copy the address into Claude (Settings > Connectors > Add custom connector) or ChatGPT
   (developer mode app), and type the 6-digit code shown on that page when the app asks. The
   collapsed "Coding agents on this computer" section pairs Claude Code, Cursor or VS Code
   ([bridge/README.md](bridge/README.md)).
11. **Settings → Submit Feedback** sends a message to the team from inside the extension; the
   backup buttons (export backup, export settings, import) are the icon row in the same menu.

## Project structure

```
src/
  sw.ts                 service worker entry (router, capture, AI, migration)
  sw/trash.ts           Trash coordinator (also records deletes made outside the extension)
  sw/folder_prefs.ts    folder colour and hidden-from-search writer
  sw/change_sets.ts     AI change sets: apply, Undo, recovery
  sw/agent_bridge.ts    one request handler for Ask AI, the connector and coding agents
  sw/remote_link.ts     the browser side of the online connector (WebSocket)
  lib/bridge/tools.ts   the shared tool list
  lib/agent/llm.ts      Ask AI's tool-calling loop (OpenAI-compatible, Anthropic, Gemini)
  lib/ai_provider_rules.ts  provider rules shared by Auto-Tag, Smart Search and Ask AI
  lib/                  shared modules (storage, trash_store, bookmark_tree, AI, backup, utils)
  popup/                React app: App.tsx, hooks/, components/ (Provider Settings and AI tabs, tiles)
  components/           TopBar, Sidebar, MainContent, TrashView, AIToolsTabs, AskAIView, AgentsView, ...
  content/capture.ts    content script
public/manifest.json    extension manifest
tests/                  Vitest suites, fakes/, sw_bridge.ts
scripts/check-bundle.mjs  post-build checks
scripts/e2e/smoke.mjs     npm run e2e: real-Chrome smoke test
scripts/e2e/bridge.mjs    real Chrome + coding-agent helper + CLI
scripts/e2e/connector.mjs real Chrome + connector Worker (wrangler dev) + an MCP client
worker/                 feedback relay (Cloudflare Worker, Resend); see worker/README.md
bridge/                 coding-agent helper: native host, MCP server, CLI (npm package)
connector/              online connector for Claude and ChatGPT (Cloudflare Worker); see connector/README.md
website/                marketing site (GitHub Pages)
docs/designs/           design documents
```

## Testing

```bash
npm run lint
npm test -- --run
npm run build && npm run check:bundle
npm run e2e        # real Chrome, headless, throwaway profile
```

459 tests cover migration, metadata merges and the metadata allowlist, API key binding, provider rules (request shape, budgets, empty replies, out-of-credit, retries, retired defaults), Trash
(delete, restore, crash recovery, expiry, asset sweep, deletes made outside the extension),
folder prefs, selection and bulk move, list columns, the feedback form, AI change sets (validation,
apply, Undo, recovery), the bridge (modes, apply and undo), Ask AI, the connector link, the
reactive bookmark tree, backups, and the whole app in jsdom. `npm run e2e` checks the core flows
in a real Chrome; `scripts/e2e/bridge.mjs` runs Chrome, the helper and the CLI together (18
checks); `scripts/e2e/connector.mjs` runs Chrome, the connector Worker under `wrangler dev` and an
MCP client through sign-in, tools, Undo and revocation (15 checks). The feedback relay has 32
tests of its own, the helper package 11 (`bridge/test/`) and the connector 36 (`cd connector &&
npm test`). See [TESTING.md](TESTING.md).

## Deployment

CI (`.github/workflows/extension-ci.yml`) is one job that runs lint, tests, build, the bundle
check, the connector tests and typecheck, and the real-Chrome smoke, bridge and connector e2e
scripts on pull requests that change code; docs-only pull requests skip it. Releases are uploaded to the Chrome Web Store by the maintainer; the
website deploys to GitHub Pages from `main`; the feedback relay and the connector are deployed
by hand with Wrangler ([worker/README.md](worker/README.md),
[connector/README.md](connector/README.md)) and served on `bookmarks-feedback.palworks.ai` and
`bookmarks-connector.palworks.ai` (their workers.dev addresses stay on for older copies). The
Cloudflare account is shared with the owner's other projects, so only these two Workers' own
settings are ever changed. Steps, the permission gate and rollback:
[PLAYBOOK.md](PLAYBOOK.md).

## Roadmap

1.6.0 is live on the Chrome Web Store. 1.7.0 (Ask AI, Connect Claude or ChatGPT, coding agents;
[docs/designs/ai-assistant.md](docs/designs/ai-assistant.md)) is in Web Store review, with the
connector Worker live and `bookmarks-thumbnails-mcp@1.7.1` on npm. `main` already holds the next
release: one AI Tools page, the provider fixes and the palworks.ai addresses. Later: Edge, Brave and Windows for coding agents, and a safety net that also recovers
changes made while Chrome was closed. See [ROADMAP.md](ROADMAP.md).

## Contributing

Issues and pull requests are welcome. Read [AGENTS.md](AGENTS.md) for the rules and
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. Contributions are accepted under
AGPL-3.0-only.

## License

Dual-licensed:

- **[GNU AGPL 3.0 only](LICENSE)** (`AGPL-3.0-only`): use, change and share the software, including
  commercially, under the AGPL's conditions.
- **Commercial licence** for use without the AGPL obligations, for example in a closed-source
  product. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Acknowledgements

Icons by [Lucide](https://lucide.dev). Site icons come from Chrome's own favicon cache. Thanks to
the users whose feedback shaped the 1.3.0 and 1.4.0 releases.
