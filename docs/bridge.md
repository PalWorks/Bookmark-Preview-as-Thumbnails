# Coding-agent bridge reference

_Last updated: 2026-11-10T11:40:58+00:00 (menu path in fix texts is now AI Tools > Connect Claude or ChatGPT)._

Reference for the `bookmarks-thumbnails-mcp` package and its protocol. Quick start and
troubleshooting: [bridge/README.md](../bridge/README.md). Design and review record:
[docs/designs/agent-bridge.md](designs/agent-bridge.md). The source of truth for messages and
errors is `src/lib/bridge/protocol.ts`, and for tools `src/lib/bridge/tools.ts` (the same list
serves Ask AI and the online connector for Claude and ChatGPT,
[docs/designs/ai-assistant.md](designs/ai-assistant.md)); `tests/bridge_version.test.ts` fails if
this page misses an error code.

## How the pieces connect

```
Coding agent ──stdio (MCP)──▶ bookmarks-thumbnails-mcp ──Unix socket (JSON lines)──▶ native host ──native port──▶ extension service worker
                                (MCP server, CLI)          <runtime dir>/chrome-<profile>.sock      (relay only)        (pairing, grants, change sets)
```

- The extension owns all state: pairing, token hashes, the folders each agent may read,
  change sets and Undo. The host only relays and tags each message with a connection number.
- Every write is one change set, validated in full first and journaled, so one click undoes it.
  What happens to it depends on the connection's mode (below).
- Linux and macOS, Chrome. Windows, Edge and Brave come later (Stage 3).

## Tools (MCP) and commands (CLI)

| MCP tool | CLI command | What it does |
|---|---|---|
| `pair` | `pair [--code 123456]` | No code: the extension shows a 6-digit code. With the code: stores the token (0600 file). |
| `list_folders` | `list-folders` | Shared folders: `{id, path, count}`. |
| `list_folder` | `list-folder <id>` | Items of one shared folder. |
| `search` | `search <query>` | Title, URL and tags, case-insensitive, best matches first. |
| `get_bookmark` | `get-bookmark <id>` | Title, URL, folder, tags, rating, last opened, whether a preview exists. |
| `apply_changes` | `apply <file.json> [--key k]` | Applies a change set at once (mode `change`) and returns `changeSetId`; in mode `propose` it waits for review instead. |
| `undo_changes` | `undo <id>` | Undoes a change set this connection made; items changed since are left alone. |
| `get_change_set` | `get-change-set <id>` | State of a change set this agent sent. Poll every 10 s at most while it waits. |
| (none) | `propose <file.json> [--key k]` | Sends a change set for review in any mode except `read`; nothing changes yet. (`propose_changes` is still a bridge request, but no longer an MCP tool.) |

## Modes

Each connection has one mode, chosen when pairing (on the code card) and changeable later in
the extension (menu > AI Tools > Connect Claude or ChatGPT):

**Table B1: Connection modes**

| Mode | Label in the extension | `apply_changes` | `undo_changes` |
|---|---|---|---|
| `change` (default for new pairings) | Read and change (with Undo) | Applies at once | Allowed, own sets only |
| `propose` | Read and suggest (I review first) | Waits in **AI changes** until the user applies it | Allowed, own sets only |
| `read` | Read only | `READ_ONLY` | `READ_ONLY` |

A refused set changes nothing and answers `accepted: false` with a reason per change. An applied
set answers `applied: true`, `changeSetId`, how many changed, and any items skipped.

Reads take `limit` (default 100, max 500) and return `cursor` when more remain. A cursor
expires after 10 minutes and whenever bookmarks, folder settings or tags change
(`CURSOR_EXPIRED`). Ids outside the folders the user shared, or inside folders hidden from
search, behave as unknown everywhere.

Other CLI commands: `install`, `uninstall`, `doctor [--json] [--last-error]`. Every command
takes `--json` (the default when stdout is not a terminal), `--browser` and `--profile`.

## Change-set format

```json
{
  "format": "bookmarks-thumbnails.changes",
  "v": 1,
  "title": "Tidy my Research folder",
  "ops": [
    { "op": "create_folder", "tempId": "new:1", "parentId": "1204", "title": "Papers" },
    { "op": "move", "id": "1210", "parentId": "new:1" },
    { "op": "rename", "id": "1211", "title": "BERT: pre-training of deep bidirectional transformers" },
    { "op": "set_tags", "id": "1210", "tags": ["nlp", "papers"] },
    { "op": "set_rating", "id": "1210", "rating": 5 },
    { "op": "trash", "id": "1219" }
  ]
}
```

Dry-run answer when something cannot be applied (nothing is stored):

```json
{ "accepted": false, "message": "1 of 6 changes can't be made, so nothing was added. Fix them or ask the AI again.",
  "results": [ { "change": 0, "ok": true }, { "change": 5, "ok": false, "reason": "Unknown id, or outside the folders you shared." } ] }
```

Rules: at most 200 changes and 1,000 items removed (Trash counts folder contents); an item
appears once per kind of change; an item sent to Trash gets no other change; create a folder
before moving into it (`new:N` may only be a parent); Chrome's own folders and managed bookmarks
cannot change; ratings are 1 to 5 or `null`; tags replace the list (at most 20, each up to 40
characters); bookmarks that share a link share tags and ratings, so two different values for one
link are refused. At most 5 proposals per agent wait at once (the limit does not apply to sets
applied at once). Pass `idempotencyKey`: a retry with the same key and the same change set
returns the first answer and never applies twice.

## Errors

Every error has the same shape on every channel:

```json
{ "code": "NOT_PAIRED", "message": "...", "fix": "one line: what to do", "retry": "after_user_action",
  "retryAfterSeconds": 30, "context": {}, "traceId": "...", "docUrl": ".../docs/bridge.md#not_paired" }
```

MCP returns it with `isError: true`. The CLI writes it to stderr and exits with:

| Code | Exit status |
|---|---|
| `NOT_CONNECTED` | 10 |
| `NOT_PAIRED` | 11 |
| `PAIRING_PENDING` | 12 |
| `READ_ONLY` | 13 |
| `INVALID_REQUEST` | 14 |
| `TOO_LARGE` | 15 |
| `RATE_LIMITED` | 16 |
| `CURSOR_EXPIRED` | 17 |
| `AMBIGUOUS_TARGET` | 18 |
| `UPDATE_EXTENSION` | 19 |
| `UPDATE_PACKAGE` | 20 |
| `INTERNAL` | 21 |

### NOT_CONNECTED
No browser profile has **Connect coding agents** on (extension menu > AI Tools > Connect Claude or ChatGPT >
Coding agents on this computer), or the profile
this agent paired with is closed. Turn the switch on in that profile. The agent never switches
to another profile by itself.

### NOT_PAIRED
This agent has no valid pairing with this profile (never paired, removed in the extension, or the
extension's data was cleared). Call `pair` with no code, then with the code the extension shows.
The saved token is deleted automatically.

### PAIRING_PENDING
The extension is showing a 6-digit code. Read it in the extension (menu > AI Tools > Connect Claude or
ChatGPT) and call `pair` with it within 2 minutes. Three wrong codes end the prompt.

### READ_ONLY
The user allowed this connection to read only. They can choose **Read and change (with Undo)**
or **Read and suggest (I review first)** for it in the extension (menu > AI Tools > Connect Claude or
ChatGPT).

### INVALID_REQUEST
The request does not match the tool's description: unknown id, bad cursor, missing field.
`message` says which.

### TOO_LARGE
A request is over 64 KB. Send fewer changes at once.

### RATE_LIMITED
Too many pairing prompts (5 an hour, one at a time), more than 4 connections, a name the user
blocked for an hour, or 5 proposals already waiting. `retryAfterSeconds` says when to retry.

### CURSOR_EXPIRED
Bookmarks changed, or the cursor is older than 10 minutes. Start the listing again.

### AMBIGUOUS_TARGET
Several browser profiles are connected and this agent has not paired with one yet. `context`
lists them; pass `browser` and `profile`.

### UPDATE_EXTENSION
The package is newer than the extension. Update the extension.

### UPDATE_PACKAGE
The extension needs a newer package. Run `npx bookmarks-thumbnails-mcp@latest install` and
update the version in your MCP configuration.

### INTERNAL
Something failed inside the extension. `traceId` matches a line in the service worker console.
Run `doctor` and send its output through Settings > Submit Feedback.

## Files and permissions

| What | Linux | macOS |
|---|---|---|
| Host manifest | `~/.config/google-chrome/NativeMessagingHosts/com.palworks.bookmarks_thumbnails.json` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/…` |
| Host copy, launcher, `host.log` | `~/.local/share/bookmarks-thumbnails/` | `~/Library/Application Support/bookmarks-thumbnails/` |
| Sockets (folder 0700, socket 0600) | `$XDG_RUNTIME_DIR/bookmarks-thumbnails/` or `/tmp/bookmarks-thumbnails-<uid>/` | `$TMPDIR/bookmarks-thumbnails/` |
| Tokens (0600) | `~/.config/bookmarks-thumbnails/tokens.json` | `~/Library/Application Support/bookmarks-thumbnails/tokens.json` |

Overrides: `BOOKMARKS_THUMBNAILS_RUNTIME_DIR`, `BOOKMARKS_THUMBNAILS_TOKEN_FILE`,
`BOOKMARKS_THUMBNAILS_DATA_DIR`. The host refuses a runtime folder that is a link, belongs to
another user or is open to others. Tokens never appear in output, errors or logs; the
extension stores only their SHA-256.

## Upgrades

`install` replaces the host copy; a running browser uses it from its next start. The MCP
server installs the host on its first run only when none is installed, and never replaces one.
The extension accepts package protocol versions from `minClient` up; `doctor` shows the
installed and the package version.
