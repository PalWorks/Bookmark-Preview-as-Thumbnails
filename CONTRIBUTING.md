# Contributing to Bookmarks Thumbnails

_Last updated: 2026-11-11T02:41:14+00:00 (usage statistics: new events follow AGENTS rule 27)._

Thank you for your interest in contributing to Bookmarks Thumbnails! We welcome contributions from everyone.

## Getting Started

1. **Fork the repository**: Click the "Fork" button at the top right of the repository page.
2. **Clone your fork**:

    ```bash
    git clone https://github.com/<your-username>/Bookmark-Preview-as-Thumbnails.git
    cd Bookmark-Preview-as-Thumbnails
    ```

3. **Install dependencies** (Node 22 or newer, as CI uses):

    ```bash
    npm install
    ```

## Development Workflow

1. **Create a branch**: Always work on a new branch for your changes.

    ```bash
    git checkout -b feature/my-new-feature
    # or
    git checkout -b fix/issue-description
    ```

2. **Make changes**: Implement your feature or fix.
3. **Test**: Run the same checks as CI.

    ```bash
    npm run lint
    npm test -- --run
    npm run build && npm run check:bundle
    npm run e2e   # real Chrome, headless, throwaway profile (CI runs it too)
    ```

    To count a new feature use, call `track()` from `src/lib/analytics.ts` and follow AGENTS
    rule 27 (no content in values; list the event in PRIVACY.md and D27).
    If you change the feedback relay in `worker/`, also run
    `cd worker && npx --yes node@22.18 --test test/index.test.ts && npm run typecheck`.
    Never add a key of ours to the extension; see rule 18 in [AGENTS.md](AGENTS.md).

    Read [AGENTS.md](AGENTS.md) first: it lists the rules that must not be broken (for
    example, deletes always go through Trash, and new files carry an SPDX header).

4. **Commit**: Use descriptive commit messages.

    ```bash
    git commit -m "feat: add new bookmark sorting option"
    ```

    We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Pull Request Process

1. Push your branch to your fork.
2. Open a Pull Request (PR) against the `main` branch of the original repository. CI runs only
   on pull requests that change code; keep documentation-only changes in their own pull request.
3. Fill out the PR template with details about your changes.
4. Wait for review. We will do our best to review your PR as soon as possible.

## Licence of contributions

This project is dual-licensed (AGPL-3.0-only and a commercial licence, see
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). By opening a pull request you confirm that you
have the right to submit the change and agree that it is licensed under AGPL-3.0-only and may
also be offered by the maintainers under the commercial licence. Say so in the PR description.

## Code Style

- Use **TypeScript** for all new code, starting with `// SPDX-License-Identifier: AGPL-3.0-only`.
- Follow the existing project structure.
- Ensure code is formatted (Prettier is configured).
- Run `npm run lint` to check for linting errors.

## Reporting Issues

If you find a bug or have a feature request, please open an issue using the provided templates.
