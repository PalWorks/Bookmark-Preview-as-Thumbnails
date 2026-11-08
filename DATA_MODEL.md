# Data model

_Last updated: 2026-11-08T10:20:54+00:00 (1.3.0: Trash keys, `sidebarHidden`, settings backup kind)._

All data is local to the browser profile. There is no server.

## chrome.storage.local

| Key | Owner (writer) | Shape | Notes |
|---|---|---|---|
| `thumb_<url>` | worker (capture), page (backup import) | `{ id, url, mime, base64 (data: URL), updatedAt, width, height, sizeBytes, filename? }` | Preview image. `<url>` is the original bookmark URL. |
| `meta_<url>` | worker via `storageIndex.patch` (pages send `META_PATCH`) | `{ id, url, title, status, lastCaptureAt?, error?, tags? }` | Always merged, never replaced, so tags survive recaptures. |
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
| `trash_recreated_folders` | worker only | `{ [folderId]: ms }` | Folders a restore recreated; a later restore of the original folder merges into them, never into a folder the user made. Pruned after 30 days. |

### TrashEntry

```ts
{
  version: 1, entryId, operationId,           // operationId groups the roots of one user action
  origin: 'manual' | 'duplicate-finder',
  title, isFolder, bookmarkCount, nodeCount,
  deletedAt, expiresAt,                       // expiresAt = deletedAt + 30 days
  parentId, index,                            // original position
  ancestors: [{ oldId, title }],              // permanent folder first, direct parent last
  scope: { rootId, rootTitle, folderType?, syncing? },
  tree: { oldId, title, url?, dateAdded?, children? },
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
{ "version": 1, "kind": "full" | "settings", "timestamp": 0, "settings": {}, "thumbnails": [] }
```

`kind` absent means a full backup (files from 1.2.x). Settings files have no `thumbnails`.
Import rejects `version > 1`, ignores unknown or invalid settings, and never changes
`ai_provider` or `ai_custom_url` while an API key is saved. Neither kind contains
`ai_enc_key` or `ai_api_key_encrypted`.

## Migrations

| Schema | When | What |
|---|---|---|
| 2 | update to 1.2.1+ | Move legacy raw-URL metadata records (`id === key`, string `url` and `status`) to `meta_<url>`; repair `meta_ai_*` keys renamed by 1.2.0; bind a pre-1.2.1 API key. Fresh installs set 2 directly. |

1.3.0 adds keys but needs no migration: Trash keys never match the legacy record shape.
