# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-06-03

### Added

- **AI Auto-Tag** — automatically categorise bookmarks with open-vocabulary tags.
  Uses Chrome's built-in Gemini Nano (on-device, nothing leaves your machine) by
  default, or any cloud provider / local server with your own API key.
- **Smart Search** — natural-language bookmark search powered by the same AI backend.
- **Duplicate Finder** — detect and merge duplicate bookmarks; shows folder and date
  detail; supports keep-oldest / keep-newest merge strategy.
- **AI Settings page** — configure built-in vs. cloud mode, provider, model, API key
  validation, model discovery, and preferred auto-tag vocabulary.
- **Cancellable batch capture** — Stop now aborts in-flight captures immediately via
  AbortController; previously it waited out full navigation timeouts.
- Architecture diagram (`architecture.d2`).
- Developer documentation (`agents.md`, `CONTRIBUTING.md`).
- GitHub Issue and PR templates.

### Changed

- Updated `README.md` and `PRIVACY.md` to accurately describe cloud-AI data flow.
- Updated `PRIVACY_DETAILS.md` (Chrome Web Store privacy questionnaire).

### Fixed

- Gemini API key is now sent via `x-goog-api-key` header, never embedded in the URL.
- Backup import validates bookmark IDs/URLs and only fetches `data:` URLs (prevents SSRF).
- File System Access handle is only retained when permission is actually granted.
- Auto-capture re-checks the batch guard after its `await` to prevent double-queuing.
- `error_generator` FileReader now rejects on error (no worker hang).
- AI Settings save-confirmation timers are guarded against setState-after-unmount.
- TopBar search input is controlled and clears on folder navigation.

## [Unreleased]

### Added

- Deployment visualization in architecture diagram.
