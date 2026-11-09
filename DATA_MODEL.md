# Data model

_Last updated: 2026-11-09T17:04:52+00:00 (1.7.0: AI change sets and coding-agent keys)._

All data is local to the browser profile. None of the 1.7.0 `cs*` or `bridge_*` keys has the legacy
metadata shape (`tests/change_sets.test.ts`), and backups never include them. The feedback form (1.6.0) stores nothing: a message
goes to the relay in `worker/` when the user presses Send, and the relay keeps no message content
(only hashed per-network rate counters, at most 26 hours; [worker/README.md](worker/README.md)).

## chrome.storage.local

| Key | Owner (writer) | Shape | Notes |
|---|---|---|---|
| `thumb_<url>` | worker (capture), page (backup import) | `{ id, url, mime, base64 (data: URL), updatedAt, width, height, sizeBytes, filename? }` | Preview image. `<url>` is the original bookmark URL. |
| `meta_<url>` | worker via `storageIndex.patch` (pages send `META_PATCH`) | `{ id, url, title, status, lastCaptureAt?, error?, tags?, rating?, lastOpenedAt? }` | Always merged, never replaced, so tags survive recaptures. `rating` 1 to 5 (1.4.0), `lastOpenedAt` ms when opened from this extension (1.4.0). Page writes pass an allowlist (`metadata_sanitize.ts`). |
| `fpref_<folderId>` | worker only (`src/sw/folder_prefs.ts`) | `{ color?: 'orange' \| 'red' \| 'pink' \| 'purple' \| 'blue' \| 'teal' \| 'green' \| 'grey', hideFromSearch?: true }` | 1.4.0. Absent means yellow and searchable. Folder ids are local to this device. |
| `fprefs_prune_pending` | worker only | `{ [folderId]: ms }` | Folders seen missing at a daily prune; their prefs go at a later prune 10 minutes or more after. |
| `storage_schema_version` | worker | `2` | Gates the one-time legacy migration. |
| `ai_enc_key` | page | base64 AES-256 key | Encrypts the API key at rest. |
| `ai_api_key_encrypted` | page | base64 `iv(12) + ciphertext` | The user's API key. |
| `ai_api_key_binding` | page, worker | `"<provider>|"` or `"custom|<origin>"` / `"ollama|<origin>"` | The key is sent only when this matches the current provider and endpoint. |
| `hasSeenWelcome` | page | `true` | |
| `trash_v1_<entryId>` | worker only | `TrashEntry` (below) | Immutable snapshot of one deleted root. |
| `trash_prog_<entryId>` | worker only | `TrashProgress` (below) | State machine and restore progress. |
| `trash_req_<requestId>` | worker only | `{ at, operationId, result? }` | Written with the snapshot; the answer is added at the end. A retry returns the answer, or continues the same operation if the worker died part-way. Removed after 10 minutes. |
| `trash_rev` | worker only | number (ms) | Bumped after every Trash change; `TRASH_CHANGED` carries it. |
| `trash_purge_pending` | worker only | `{ urls: string[], at }` | Asset sweep journal; a crash resumes it. |
| `trash_restoring_until` | worker only | number (ms) | Auto-capture skips bookmark creations until then (read by the incognito worker). |
| `cs_<setId>` | worker only (`src/sw/change_sets.ts`) | `ChangeSetRecord`: the change set as received, a verdict and baseline per change, apply order, `approval {at, selected}`, `state`, `clientId?` | 1.7.0. AI change sets. Pending sets expire after 24 h; decided sets are removed after 30 days. Never in backups. |
| `csj_<setId>` | worker only | `{ setId, count, startedAt, lastProgressAt }` | Journal header. |
| `csj_<setId>_<n>` | worker only | `{ k, n, kind, state, before, after, reason?, createdId?, intentAt?, url?, trashOperationId?, trashEntryId?, idMap? }` | One journal item per change, written before the change runs. At most 50 journals are kept; older sets keep their row without Undo. |
| `cssnap_<snapshotId>` | worker only | `{ folderIds, createdAt }` | Folders an "Organise with an AI" export shared; an answer that names this snapshot may touch only them. Removed after 7 days. |
| `bridge_settings` | worker only (`src/sw/agent_bridge.ts`) | `{ enabled, profileId }` | 1.7.0. Coding agents switch and a random 8-character profile id. |
| `bridge_clients` | worker only | `{ [clientId]: { id, name, tokenHash, pairedAt, lastUsedAt?, folderIds, stripQuery, mode: 'read' \| 'propose' } }` | Paired coding agents. Only the SHA-256 of each token is stored. |
| `bridge_idem` | worker only | `{ ["clientId|key"]: { setId, hash, at } }` | Proposal idempotency keys, 24 h. |
| `trash_recreated_folders` | worker only | `{ [folderId]: ms }` | Folders a restore recreated; a later restore of the original folder merges into them, never into a folder the user made. Pruned after 30 days. |

### TrashEntry

```ts
{
  version: 1, entryId, operationId,           // operationId groups the roots of one user action
  origin: 'manual' | 'duplicate-finder' | 'external' | 'ai-changes',   // external: deleted outside this extension (1.4.0)
  title, isFolder, bookmarkCount, nodeCount,
  deletedAt, expiresAt,                       // expiresAt = deletedAt + 30 days
  parentId, index,                            // original position
  ancestors: [{ oldId, title }],              // permanent folder first, direct parent last
  scope: { rootId, rootTitle, folderType?, syncing? },
  tree: { oldId, title, url?, dateAdded?, children? },
  folderPrefs?: { [oldFolderId]: { color?, hideFromSearch? } },  // 1.4.0, re-applied on restore
  seq?: number,                               // 1.4.0, external: event order within the operation
}
```

No image data is stored in an entry; previews stay in `thumb_<url>` while the bookmark is in
Trash.

### TrashProgress

```ts
{ entryId, state: 'prepared' | 'deleted' | 'restoring' | 'restored' | 'failed',
  updatedAt, restoreStartedAt?, created?, error?, needsDestination?,
  restoredTo?: { parentId, rootId, path }, partialRootId?, keepUntil? }
```

## chrome.storage.sync (settings)

| Key | Type | Valid values |
|---|---|---|
| `useIncognito` | boolean | |
| `theme` | string | `light`, `dark`, `system` |
| `captureDelay` | number | 100 to 30000 (ms) |
| `useActiveTabCapture` | boolean | |
| `sidebarHidden` | boolean | Desktop folder panel hidden (1.3.0) |
| `listColumns` | string[] | any of `added`, `opened`, `rating`, `visits`, `lastVisited` (1.4.0; default `added`, `opened`, `rating`) |
| `trashExternal` | boolean | Keep deletes made outside the extension in Trash (1.4.0; default true) |
| `ai_mode` | string | `builtin`, `cloud` |
| `ai_provider` | string | a provider id from `PROVIDERS` |
| `ai_model` | string | up to 200 characters |
| `ai_custom_url` | string | http(s) URL without credentials, query or fragment |
| `ai_custom_tags` | string | comma-separated, up to 2000 characters |

`SETTINGS_SCHEMA` in `src/lib/backup_manager.ts` is the single allowlist for export and import.

## IndexedDB (`bookmarks_thumbs`)

- `thumbnails`: legacy preview records from early versions; migrated lazily to
  `thumb_<url>` on read and removed by the Trash asset sweep.
- `handles`: the File System Access folder handle for "Choose storage folder".

## Backup files

```json
{ "version": 1, "kind": "full" | "settings", "timestamp": 0, "settings": {}, "thumbnails": [],
  "metadata": [{ "url": "", "rating": 4, "lastOpenedAt": 0, "tags": [] }],
  "folderPrefs": [{ "path": ["Bookmarks bar", "Work"], "color": "teal", "hideFromSearch": true }] }
```

`metadata` (full backups, 1.4.0) carries the user's own fields for every link, keyed by the
bookmark URL; import fills a rating or tags only where none is stored and keeps the later
opened time, decided inside the worker's per-URL queue. `folderPrefs` (both kinds, 1.4.0) names
folders by title path; import applies an item only to the one folder with exactly that path.
Caps: 2,000 folder prefs, paths of up to 64 parts.

`kind` absent means a full backup (files from 1.2.x). Settings files have no `thumbnails`.
Import rejects `version > 1`, ignores unknown or invalid settings, and never changes
`ai_provider` or `ai_custom_url` while an API key is saved. Neither kind contains
`ai_enc_key` or `ai_api_key_encrypted`.

## Migrations

| Schema | When | What |
|---|---|---|
| 2 | update to 1.2.1+ | Move legacy raw-URL metadata records (`id === key`, string `url` and `status`) to `meta_<url>`; repair `meta_ai_*` keys renamed by 1.2.0; bind a pre-1.2.1 API key. Fresh installs set 2 directly. |

1.3.0 and 1.4.0 add keys but need no migration: none of them match the legacy record shape.
