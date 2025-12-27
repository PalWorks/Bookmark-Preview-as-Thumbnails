# Agent Instructions

This file provides context and instructions for AI agents working on the **Bookmarks Thumbnails** project.

## Project Overview

This is a Chrome Extension (Manifest V3) built with React, TypeScript, and Vite. It replaces the standard bookmarks view with a visual thumbnail grid. There is also a companion marketing/documentation website.

## Directory Structure

- `/src`: Source code for the Chrome Extension.
  - `/src/components`: Reusable React components.
  - `/src/popup`: Entry point for the extension popup.
  - `/src/content`: Content scripts (if any).
  - `/src/lib`: Utility functions and helpers.
  - `/sw.ts`: Service Worker (background script).
- `/website`: Source code for the companion website (React + Vite).
- `/public`: Static assets for the extension (manifest.json, icons).
- `/dist`: Build output for the extension.

## Key Files

- `manifest.json`: Configuration for the Chrome Extension. **CRITICAL**: Ensure permissions are minimal and justified.
- `vite.config.ts`: Build configuration. Note the multi-page entry points for extension components.
- `architecture.d2`: System architecture diagram.

## Code Style & Conventions

- **Framework**: React 19 with Functional Components and Hooks.
- **Language**: TypeScript. Use strict typing; avoid `any`.
- **Styling**: Vanilla CSS. Keep it simple and maintainable.
- **Icons**: Use `lucide-react`.
- **State Management**: React Context or local state. Avoid complex external libraries unless necessary.
- **Async/Await**: Prefer `async/await` over `.then()`.

## Common Tasks

### Adding a New Feature

1. Identify if it requires new permissions in `manifest.json`.
2. Implement the UI in `src/components`.
3. Add logic in `src/popup` or `sw.ts` as needed.
4. Ensure it works in both Light and Dark modes.

### Updating the Website

1. Work within the `website` directory.
2. Ensure consistency with the extension's branding.

## Testing

- Run unit tests with `npm test` (Vitest).
- Ensure no regressions in the build process (`npm run build`).
