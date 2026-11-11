# Architecture

_Last updated: 2026-11-11T05:30:59+00:00 (connector token budgets, remote token expiry, keyboard menus)._

Bookmarks as Thumbnails is a Chrome Manifest V3 extension. It has two small servers of its own:
the feedback relay in `worker/`, used when someone sends the feedback form (1.6.0) and for
anonymous usage statistics (1.8.0, unless the user turns them off), and the
online connector in `connector/`, used only while the user has "Let Claude and ChatGPT organise
my bookmarks" on (1.7.0). Everything else runs in three browser contexts and stores data in
`chrome.storage`. Storage keys and
record shapes are in [DATA_MODEL.md](DATA_MODEL.md); the reasons behind the main choices
are in [DECISIONS.md](DECISIONS.md).

## Contexts and boundaries

```
 Extension page (index.html, React)                Service worker (sw.js)
 ┌─────────────────────────────────────┐ messages  ┌───────────────────────────────────────────┐
 │ App.tsx: composes hooks, no logic    │──────────▶│ router (sw.ts, listeners return true)     │
 │  useBookmarkTree ◀─ bookmarks.on*    │           │  ├─ BATCH_CAPTURE / STOP_CAPTURE          │
 │  useThumbnails   ◀─ THUMBNAIL_*      │◀──────────│  │    hidden window, 5-tab worker pool    │
 │  useTrash  ── TRASH_* ──────────────▶│ broadcasts│  ├─ META_PATCH ─▶ storageIndex.patch      │
 │            ◀─ TRASH_CHANGED          │           │  ├─ AUTO_TAG / AI_SEARCH / CHECK_AI_*     │
 │  useAITagger ◀─ TAG_*                │           │  └─ TRASH_* ─▶ src/sw/trash.ts            │
 │  useToast, useSettings, useClipboard │           │        one promise queue (single writer)  │
 │  useContextMenu, useMediaQuery       │           │        reconcile() before every mutation  │
 │  useSelection, useLinkMeta ◀─ META_UPDATED │     │  bookmarks.onRemoved ─▶ trash.noteRemoved │
 │  useFolderPrefs ── FOLDER_PREFS_SET ▶│           │  FOLDER_PREFS_SET ─▶ src/sw/folder_prefs  │
 │       ◀─ FOLDER_PREFS_CHANGED        │           │        (single writer of fpref_*)         │
 │  useHistoryStats (optional history)  │           │                                           │
 │ Components: TopBar, Sidebar (docked  │           │  bookmarks.onCreated ─▶ auto-capture      │
 │  or drawer), MainContent, TrashView, │           │        (skipped while a restore runs)     │
 │  FolderPicker, Modal, Toast,         │           │  alarms 'trash-purge' (daily) ─▶ expiry   │
 │  BookmarkPreview, AISettingsPage     │           │  onInstalled ─▶ schema-gated migration    │
 └──────────────┬──────────────────────┘           └──────────────┬────────────────────────────┘
                │ reads (getKeys + targeted get)                  │ writes
                └──────────────── chrome.storage.local ◀──────────┘
                     thumb_<url>  meta_<url>  trash_*  fpref_<folderId>  storage_schema_version  ai_*
                     chrome.storage.sync: settings          IndexedDB: legacy previews, folder handle

 Content script (content-script.js): page-side capture helper injected into capture tabs.

 Feedback form (page, src/lib/feedback.ts) ── POST /feedback, only on Send ──▶ worker/ relay ──▶ Resend ──▶ support@
 track() (page or worker, src/lib/analytics.ts) ── POST /events, batched ──▶ worker/ relay ──▶ GA4 + PostHog EU
```

- **Service worker** (`src/sw.ts`): message router, capture orchestration, AI batch
  tagging, update migration, Trash upkeep. Listeners that answer asynchronously return
  `true` synchronously (a shipped bug once; do not reintroduce). Trash logic lives in
  `src/sw/trash.ts`, which has no import side effects so tests can build fresh instances.
- **Extension page** (`src/popup/`): React 19. `App.tsx` only composes hooks and renders
  components; behaviour lives in `src/popup/hooks/`.
- **Shared libraries** (`src/lib/`): imported by both sides, so they stay free of DOM and
  React where the worker uses them (`trash_store`, `bookmark_tree`, `storage_index`,
  `utils`, `ai_settings_storage`). CI enforces this with `scripts/check-bundle.mjs`.

## Trash (1.3.0)

The worker is the only writer of `trash_*` keys. Every mutation (`TRASH_DELETE`,
`TRASH_RESTORE`, `TRASH_EMPTY`, `TRASH_PURGE`) runs through one in-memory promise queue,
so two tabs pressing Undo at once produce one copy. Pages read Trash directly and refresh
on the `TRASH_CHANGED` broadcast, never on raw `storage.onChanged` (that would also deliver
every preview image a capture writes).

```
           TRASH_DELETE: snapshot written        bookmark removed
 (none) ───────────────────────────▶ prepared ───────────────────▶ deleted ◀────────┐
                                       │ removal failed                │ restore      │
                                       ▼                               ▼              │
                                 (entry dropped)                   restoring          │
                                                                    │       │         │
                                                              done  │       │ error   │
                                                                    ▼       ▼         │
                                                             restored     failed ─────┘
                                                            (10 min)   (Retry resumes)
```

- **Delete.** Validate every id (missing ids are skipped; a permanent or managed node
  rejects the whole request so one action is always one Undo). Drop ids nested in another
  selected folder. Snapshot each root (subtree, index, ancestors, storage scope) and write
  all snapshots in one `storage.local.set` before the first removal. Just before removing a
  folder, re-read it and update the snapshot if something was moved in meanwhile. Remove
  each root; failures drop only that root's entry.
- **Restore.** Put roots back in ascending original index. Parent lookup: the deepest
  surviving ancestor in the same storage scope (recreating missing folders below it by
  title, reusing a same-titled folder), else a permanent folder with the same
  `folderType` and `syncing`, else fail closed and ask the user with the **Restore to...**
  picker. A title never chooses a scope, so a local bookmark is never moved into synced
  account storage automatically.
- **Crash recovery.** `reconcile()` runs on worker start and before each queued mutation:
  `prepared` with the bookmark still present is dropped (the delete never happened),
  otherwise promoted to `deleted`; a `restoring` entry is stale and becomes `failed`.
  A retried restore reuses nodes the interrupted attempt created (same parent, title and
  URL, created between that attempt's start and its failure record), so Retry never
  duplicates, even when the worker died before any checkpoint. A partial copy moves with the
  user to a new Restore to... destination. A folder restored after one of its children
  merges into the copy that child's restore recreated (never into a folder the user made).
  Progress is a small separate record, checkpointed every 25 creates, so large restores do
  not rewrite the snapshot.
- **Auto-capture guard.** While a restore creates bookmarks, `onCreated` auto-capture is
  skipped for 60 seconds after the last create (the incognito worker reads the same
  deadline from storage).
- **Expiry and Empty.** Entries expire after 30 days (daily alarm, and whenever Trash
  opens); restored entries linger 10 minutes so a repeated Undo is a no-op. Empty and
  expiry run an asset sweep journaled in `trash_purge_pending`: a URL's `thumb_`, `meta_`
  and legacy IndexedDB preview are removed only when no live bookmark and no remaining
  entry uses it. A capture that finishes after its bookmark was deleted writes nothing (the
  worker checks the bookmark still exists right before writing).
- **Incognito.** With `incognito: "split"`, the incognito worker answers `TRASH_*` with a
  read-only error and incognito pages disable delete. Only the regular worker records
  deletes made outside the extension.

Verified on Chrome 156 (2026-11-08): `removeTree` fires one `onRemoved` for the root and
its `node` carries the full subtree; permanent folders expose `folderType` and `syncing`.

## Deletes made outside the extension (1.4.0)

`chrome.bookmarks.onRemoved` (regular worker, registered at top level so it wakes the worker)
calls `trash.noteRemoved` synchronously. It buffers the event and immediately starts looking
up the parent's location, because a later event in the same burst may remove the parent too.
Three seconds after the last event (or at 5,000 events, or 60 seconds after the first) the
buffer is written as one operation, inside the Trash queue:

- dropped: events without a node, permanent folders, managed (policy) nodes, ids the
  extension itself is removing (`deleteNow` marks them first; unmarked again if the removal
  fails) and roots of saved entries (covers a worker restart), and everything when the sync
  setting `trashExternal` is false;
- children removed before their folder (bottom-up sync) are put back inside the folder's
  saved tree;
- a root whose parent was already gone when its event arrived is not kept (the shape of an
  account tree disappearing at sign-out; not tested against a real sign-out);
- each entry gets ancestors and scope like an extension delete, and its original position,
  rebuilt by replaying the burst's removals backwards (each event's index was taken after the
  earlier removals);
- restore of an external entry reuses an identical bookmark, or a folder with the same title
  and links, already under the destination (it may have come back from another device), each
  existing node at most once.

Events buffered when the worker is shut down are lost; Chrome keeps the worker alive for 30
seconds after an event, longer than the 3-second wait.

## Folder prefs (1.4.0)

Colour and "hidden from search" per folder, in `fpref_<folderId>` (local storage: folder ids
differ per device). `src/sw/folder_prefs.ts` is the only writer, behind its own queue; pages
send `FOLDER_PREFS_SET` and reload on `FOLDER_PREFS_CHANGED` or `TRASH_CHANGED`. Trash
snapshots the prefs of every folder it keeps and re-applies them to the new ids on restore. The
daily alarm prunes prefs of folders that have been missing for at least 10 minutes, after the
Trash buffer is written. Exports carry prefs by folder title path; import applies them only to
a folder with exactly that path.

Search (`useBookmarkTree`) reads the tree in the same pass as the results, so the parent map is
never stale, and holds matches inside hidden folders apart until the user presses Show them
(per query). Smart Search leaves hidden folders out of every scope above them.

## Selection and bulk actions (1.4.0)

`useSelection` keeps ids for the current view (folder, search, filter, sort); ranges use the
display order at click time and items that leave the view are forgotten. Bulk delete is one
`TRASH_DELETE` (one Undo). Bulk move (`src/lib/bulk_move.ts`) runs in the page: it drops items
inside another selected folder, refuses Chrome's own folders, managed items and a folder into
itself, records every original position before the first move, and Undo moves them back per
folder in ascending original position. Its Undo lives as long as the toast. Bulk open reads
folders' current children when opening; more than 20 tabs asks inside the bar.

Cut and Paste (1.5.0) uses the same `moveNodes`, so it has the same refusals and Undo. Rename goes
through `src/lib/rename.ts`. Every move and rename Undo checks first that the item still carries
our change (the folder we moved it to, the name we gave it) and otherwise leaves it alone (D15).

## Capture flow

`BATCH_CAPTURE` → hidden window → tab pool navigates, waits for load and a render delay →
`captureManager.capture()` → resize and compress to WebP → `thumb_<url>` (and the
connected folder, if any) → `storageIndex.patch()` → `THUMBNAIL_UPDATED` broadcast. Failed
navigations get a generated error image. The storage id is always the original bookmark
URL, even after redirects. Closing the capture window stops the batch (nothing is written for
the rest), an extension call every 20 s keeps the worker alive through long load waits and
capture delays, and the window and batch state are always cleaned up in one `finally` (1.8.0).
Previews are made only through `BATCH_CAPTURE` (one link is a batch of one).

## Page data flow

- `useBookmarkTree` subscribes to all bookmark events and coalesces bursts into one
  refresh per 150 ms (paused during a bookmark import). If the open folder disappears it
  moves to the nearest surviving ancestor.
- `useThumbnails` keeps loaded previews in memory and reads only missing ones on refresh;
  object URLs are revoked on replace and unmount.
- `useAITagger` reads only the open folder's `meta_<url>` records; `useLinkMeta` reads rating
  and "opened" time for the links in view and re-reads the ones named by `META_UPDATED`.
- `META_PATCH` accepts only allowlisted fields with valid values
  (`src/lib/metadata_sanitize.ts`); backup import merges inside the worker's per-URL queue so a
  newer rating is never overwritten.
- `useHistoryStats` reads `history.getVisits` for the links in view only when the optional
  `history` permission is granted and a history column or sort is on; nothing is stored.
- `BookmarkPreview` shows the screenshot, else the site icon from `/_favicon/` with the
  domain.

## Layout

Desktop (720px and wider): top bar, docked folder panel (hideable, remembered in sync
storage), content. Below 720px: compact top bar (Folders, title, theme, settings; full-width
search; one tool row), folder panel as a drawer, one-column grid, full-width toast and
bottom-aligned dialogs. Colours for new components come from tokens in
`src/popup/index.css` (`--color-*`, `--folder-*`), redefined under `.theme-dark`.

## External dependencies

React 19, lucide-react, html2canvas-pro 2.5.2 (capture; replaced html2canvas 1.4.1 in 1.6.0). Two network services of our own. The
online connector (`connector/`, `https://bookmarks-connector.palworks.ai`; the old
`bookmarks-thumbnails-connector.sunmooncal.workers.dev` address stays on for 1.7.0) is described under "Online connector" below. The
feedback relay in `worker/` (Cloudflare Worker, `https://bookmarks-feedback.palworks.ai`; the old workers.dev address stays on for 1.6.0 and 1.7.0),
called only when the user sends the feedback form (`src/lib/feedback.ts`, D16). It emails
support@palworks.ai through Resend. The same Worker's `/events` takes usage statistics (below).
Optional AI calls (Auto-Tag, Smart Search, Ask AI) go only
to the provider the user configures (see PRIVACY.md).

## Usage statistics (1.8.0, D27)

```
 page or worker ── track(name, params) ──▶ safeParams: numbers, booleans, short words only
                                           queue (2 s debounce, max 20 per batch)
                    flush() ── usage_stats off or incognito? drop ──▶ POST /events (keepalive)
                    body: { cid: analytics_cid, sid: analytics_sid, v, dev?, events: [{n, p, ago}] }

 worker/src/events.ts  origin check, EVENTS_BURST limit, cleanBatch (same checks again), 204,
                       then in the background: GA4 Measurement Protocol (G-Y7EQS9EYQB) and
                       PostHog /batch/ (EU, project 344404). Country from Cloudflare; no IP; no storage.
```

- **Where events come from.** The service worker counts feature messages it receives
  (`eventForMessage`: previews, Auto-Tag, Smart Search, AI changes, Trash, connector, coding
  agents, Ask AI tools) and install or update. Pages count opening the app or panel, search,
  view mode, Ask AI messages (provider type and whether a folder was attached), backups and
  feedback. One `track()` per user action; nothing is counted in a loop.
- **Identity.** `analytics_cid` is a random UUID in `chrome.storage.local`: not synced, not in
  backups, gone on uninstall. `analytics_sid` is a number per browser session in
  `chrome.storage.session`. PostHog gets `$process_person_profile: false`, so no person profiles.
- **Development copies.** Any id other than the store id sends `dev: true`; GA4 gets
  `debug_mode` (DebugView only) and PostHog the `dev` property, so test traffic stays out of reports.
- **Failures.** Statistics are best effort: a failed send is dropped and never retried, and never
  touches the feature that called `track()`.

## AI changes (1.7.0)

Design: [docs/designs/agent-bridge.md](docs/designs/agent-bridge.md) and
[docs/designs/ai-assistant.md](docs/designs/ai-assistant.md); decisions D18 to D20.

```
 copy and paste (CS_IMPORT) ────────────────┐                        ┌─ chrome.bookmarks (create, move, update)
 any client, mode propose (propose/apply) ──┴─▶ importText ─▶ pending cs_<id> ─▶ Review panel ── CS_APPLY(selected) ─┐
 Ask AI, or a client in mode change (apply_changes) ─▶ importAndApply (validate, store, apply in one queued job) ──────┤
                                                                                                                     ▼
                         journal csj_<id>_<n> per item ─▶ apply ─▶ Activity (Undo, Finish) ─┼─ storageIndex.update (tags, ratings)
                                                                                            └─ trash.deleteItems(expectedSubtrees, origin ai-changes)
```

- **One format** (`src/lib/change_set/format.ts`) and **one validator** (`validate.ts`) for every
  source. The validator simulates the set on a working copy of the tree and refuses the whole
  set, with a reason per change, on any problem.
- **One coordinator** (`src/sw/change_sets.ts`) in the regular worker runs Apply, Finish and Undo
  one at a time. Each change is journaled before it runs and re-checked against what the user
  reviewed; a changed item is skipped, never overwritten. Trash runs last as one batch whose
  approved contents are frozen. Undo runs in reverse and maps ids that Trash restore changed.
  A fresh worker runs no job, so a set left mid-apply is classified item by item at start-up.
- **Export** (`snapshot.ts`): only folders the user ticks, never hidden ones; optional query
  stripping; the instructions tell any AI how to answer. Since D20 this copy and paste path is
  "Other ways: copy and paste" in Ask AI and the AI changes empty state.
- **Apply now** (D20): `importAndApply` validates the whole set, stores it and applies every
  change in one queued job. The caps on sets waiting for review do not apply to it, because it
  never waits. The result names the set, so the chat card, AI changes or the AI itself
  (`undo_changes`, own sets only) can undo it.

## One request handler, three ways in (1.7.0, D20)

```
 Ask AI (extension page) ── AGENT_TOOL ─────────────────────────────────────────────┐
 Claude / ChatGPT ─HTTPS─▶ connector Worker ─WebSocket─▶ remote_link.ts ─────────────┼─▶ agent_bridge.ts handleRequest ─▶ change_sets.ts
 coding agent ─stdio MCP─▶ bookmarks-thumbnails-mcp ─Unix socket─▶ native host ──────┘    (client, scope, mode, limits)
```

- **Shared tools** (`src/lib/bridge/tools.ts`): one list of names, descriptions, input schemas and
  the bridge request each maps to: `list_folders`, `list_folder`, `search`, `get_bookmark`,
  `apply_changes`, `undo_changes`, `get_change_set`. Ask AI, the connector Worker and the local MCP
  server all read it; the local MCP server adds `pair`.
- **Clients** carry `mode` (`read`, `propose`, `change`; `change` is the default for new pairings)
  and `transport` (`local` or `remote`). `apply_changes` applies at once in `change` mode and
  becomes a proposal that waits in AI changes in `propose` mode; `read` refuses it with
  `READ_ONLY`.
- **Ask AI** is the built-in client "Ask AI" (`ASK_AI_CLIENT`): never stored or paired, mode
  `change`, every folder not hidden from search in scope.

## Ask AI (1.7.0, D20)

- `src/components/AskAIView.tsx` and `src/popup/hooks/useAskAI.ts` in the extension page;
  `src/lib/agent/llm.ts` runs the tool-calling loop with the provider settings and the bound key
  from Provider Settings (D2). Three wire formats: OpenAI-compatible chat completions (most providers,
  Ollama, custom servers), Anthropic Messages, Gemini. Perplexity and Chrome's built-in model
  cannot call tools and are not offered.
- At most 12 tool calls per message; each tool result sent back to the model is cut at 24,000
  characters. Each call goes to the worker as `AGENT_TOOL` (extension pages in regular windows
  only) and runs through the bridge handler as "Ask AI".
- Requests are built by `src/lib/ai_provider_rules.ts` (D21), shared with Auto-Tag and Smart
  Search in `src/lib/ai_tagger.ts`: OpenAI gets `max_completion_tokens` and no temperature; a
  300-token floor plus 4,096 tokens of headroom for models that think anyway (named sets keyed
  `provider:model`); Gemini thinking is off for tagging and search and dynamic for Ask AI; a 200
  with no answer cut at the limit throws `EmptyReplyError`; out of credit is named before rate
  limits; 429 (unless out of credit), 5xx and network errors retry twice with `Retry-After` (at
  most 10 s), never our own abort or timeout. Retired default models are upgraded on load only
  when the stored id is exactly the retired one.
- **Side panel (D24)**: the top bar's Ask AI icon toggles `AskAIView variant="dock"` beside the
  main content (`App.tsx`, state `askDock`, kept in `sessionStorage`); a fixed sheet under 900px.
  The menu's **AI Tools** item opens the page variant, whose side pane shows previews
  (`src/components/AskAIPreviews.tsx`, rows from `src/lib/agent/previews.ts`) or the chats list.
  Both share one `useAskAI` state at App level.
- **Chats** (`src/lib/agent/chat_store.ts`): an index plus one record per chat in
  `chrome.storage.local`, 50 at most; the open chat's id in the tab's `sessionStorage` (1.8.0), so
  two tabs never write the same chat.
- **Model picker** (`src/lib/agent/models.ts`): lists the key's chat models (speech, image,
  embedding and similar ids filtered out; OpenRouter limited to models that take tools) and keeps
  Ask AI's own choice per provider in `ask_ai_model`. The system prompt names the model and provider.
- **Trash approval and Redo**: `agent_bridge.ts` stores an Ask AI set that sends to Trash as
  pending (`needsApproval`); the chat's Apply card sends `CS_GET` then `CS_APPLY`, Don't sends
  `CS_REJECT`. `CS_REDO` (`change_sets.ts`) replays an undone set as a new set, once (`redoneAs`).
- **Earlier entry points** (D23): the menu's single **AI Tools** item opens one
  page whose tab bar (`src/components/AIToolsTabs.tsx`) is shared by `AskAIView`,
  `AISettingsPage` (Provider Settings, Auto-Tag, Smart Search, Duplicate Finder), `AgentsView`
  (Connect Claude or ChatGPT) and `AIChangesView`. `App.tsx` maps each tab to its panel.
- The conversation is kept in `chrome.storage.session` (`ask_ai_chat`, last 200 messages), so it
  ends with the browser session. The panel names the provider and model that receive what it
  reads.

## Online connector (1.7.0, D20)

```
 Claude / ChatGPT servers ──HTTPS (MCP + OAuth 2.1)──▶ Worker /mcp/<linkId> ──▶ Durable Object LinkObject <linkId>
                                                                                  │ WebSocket (opened by the browser)
                                                                                  ▼
                                                               extension service worker (remote_link.ts ─▶ agent_bridge.ts)
```

- **Browser side** (`src/sw/remote_link.ts`, regular worker only): turning the switch on creates
  `linkId` (16 random bytes) and `secret` (32 bytes) in `connector_link`. The worker opens
  `wss://<origin>/link?id=<linkId>` and sends `hello {linkId, secret}`; pings every 20 s keep
  the socket and the worker alive, a socket silent for 60 s is closed, and an alarm retries every
  minute. Each `request` frame is handed to the bridge as a `remote` request; its answer goes out
  on whichever socket is live, and the Worker keeps requests in flight for 5 s after a drop so an
  answer sent after a reconnect still reaches the AI app (1.8.0).
- **Wire contract** (`src/lib/bridge/connector.ts`): frame types, id formats, keepalive and the
  30 s request timeout, shared by the extension and the Worker.
- **Sign-in**: the Connect page shows a standing 6-digit code (the invite, memory only; it changes
  every 10 minutes and ends after 5 wrong tries) with the folders and mode it grants. The
  Worker's authorize page sends `pair` with the typed code through the link; the extension
  answers with a token, which the Worker wraps in a one-time authorization code (2 minutes) and
  exchanges with PKCE S256. The app's access token is the extension token; the extension stores
  only its SHA-256. Removing the connection in the extension revokes it.
- **Make a new address** replaces `linkId` and `secret` and removes every `remote` client.
- **Token life and budgets** (1.8.1): the extension removes a `remote` client unused for 90 days.
  The link's Durable Object keeps `tok:<sha256>` for tokens the browser accepted in the last day;
  those share 60 requests a minute, any other token 20, and a token the browser refused is answered
  401 for 10 minutes without a relay.
- **Worker** (`connector/`): stateless client registration (HMAC-signed client ids), per-link and
  per-network limits, no bookmark data and no long-lived tokens stored. Served on
  `bookmarks-connector.palworks.ai` (`CONNECTOR_ORIGIN`, D22) and on its workers.dev address for
  1.7.0 copies; both reach the same Durable Objects, and every OAuth address is derived from the
  request's own origin, so a link works on either. Details:
  [connector/README.md](connector/README.md).

## Coding-agent bridge (1.7.0)

```
 agent ─stdio MCP─▶ bookmarks-thumbnails-mcp ─Unix socket─▶ native host (bridge/src/host.ts) ─native port─▶ agent_bridge.ts
                    (bridge/src/mcp.ts, cli.ts)  0600 socket in a 0700 folder      relay only, conn-tagged        pairing, grants, reads, changes
```

- The extension owns all state; the host is stateless and replaceable. Messages and errors
  are defined once in `src/lib/bridge/protocol.ts`, bundled into the package.
- `nativeMessaging` is optional, requested from the switch's click; the port keeps the worker
  alive while connected; the worker reconnects at start and from a one-minute alarm.
- Pairing: the extension shows a 6-digit code; the client sends it with the random pairing id it
  started with; the token goes back once and only its SHA-256 is stored.
- Reads see only the folders granted to that agent, minus folders hidden from search; cursors
  go stale on any change. In `change` mode `apply_changes` applies at once with Undo; in
  `propose` mode (and for the CLI's `propose`) changes become pending change sets labelled with
  the agent, and the toolbar badge counts them.

## Diagram

`architecture.d2` / `architecture.svg` (render with `d2 architecture.d2 architecture.svg`). The
diagram predates 1.7.0 and shows neither the bridge nor the connector; the text diagrams above
are current. Add both to `architecture.d2` and regenerate the SVG with `d2`; do not edit the SVG
by hand.
