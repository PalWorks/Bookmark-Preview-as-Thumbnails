# Contributing to Bookmarks Thumbnails

Thank you for your interest in contributing to Bookmarks Thumbnails! We welcome contributions from everyone.

## Getting Started

1. **Fork the repository**: Click the "Fork" button at the top right of the repository page.
2. **Clone your fork**:

    ```bash
    git clone https://github.com/yourusername/bookmarks-thumbnails.git
    cd bookmarks-thumbnails
    ```

3. **Install dependencies**:

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
3. **Test**: Run tests to ensure nothing is broken.

    ```bash
    npm test
    ```

4. **Commit**: Use descriptive commit messages.

    ```bash
    git commit -m "feat: add new bookmark sorting option"
    ```

    We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Pull Request Process

1. Push your branch to your fork.
2. Open a Pull Request (PR) against the `main` branch of the original repository.
3. Fill out the PR template with details about your changes.
4. Wait for review. We will do our best to review your PR as soon as possible.

## Code Style

- Use **TypeScript** for all new code.
- Follow the existing project structure.
- Ensure code is formatted (Prettier is configured).
- Run `npm run lint` to check for linting errors.

## Reporting Issues

If you find a bug or have a feature request, please open an issue using the provided templates.
