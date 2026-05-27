# Development & Contribution Workflow

This project is a production-grade AI-powered SaaS platform. We follow a strict Gitflow-based branching strategy to maintain stability, enable continuous delivery, and accommodate multiple developers (and AI agents).

## Branch Architecture

- **`main`**: The production-ready stable branch. **Never commit directly to `main`.**
- **`develop`**: The primary integration and staging branch. All new features and non-emergency bug fixes are merged here first.
- **`feature/*`**: Isolated branches for new feature development.
- **`hotfix/*`**: Emergency fixes that go directly to production.

## Branch Naming Conventions

All branches must adhere to the following naming conventions:
- **Features**: `feature/<issue-number>-<short-description>` (e.g., `feature/142-whatsapp-rag-agent`)
- **Bug Fixes**: `bugfix/<issue-number>-<short-description>` (e.g., `bugfix/89-fix-auth-token-refresh`)
- **Hotfixes**: `hotfix/<issue-number>-<short-description>` (e.g., `hotfix/150-fix-production-crash`)
- **Chores/Maintenance**: `chore/<short-description>` (e.g., `chore/update-dependencies`)

## Development Workflow

1. **Start from `develop`**
   ```bash
   git checkout develop
   git pull origin develop
   ```
2. **Create your feature branch**
   ```bash
   git checkout -b feature/<feature-name>
   ```
3. **Develop & Commit**
   - Keep commits clean, modular, and focused.
   - Use meaningful, imperative commit messages (e.g., "Add RAG memory system to AI agent").
4. **Push & Create Pull Request (PR)**
   ```bash
   git push origin feature/<feature-name>
   ```
   - Open a PR against the `develop` branch.
   - Ensure the PR description explains *what* was changed and *why*.
5. **Review & Merge**
   - At least one code review approval is required.
   - CI/CD checks must pass before merging.
   - Squash and merge your commits if there are many WIP commits.

## Hotfix Workflow (Emergency Production Fixes)

If a critical bug is found in production (`main`):
1. **Branch from `main`**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/<issue-name>
   ```
2. **Fix & PR**
   - Fix the issue and test thoroughly.
   - Open a PR against `main`.
3. **Merge**
   - Once approved, merge the hotfix into `main` (which triggers a production deployment).
   - **Crucially**, you must also merge the hotfix back into `develop` so the fix is not overwritten by the next release.

## GitHub Protections (Required)

To enforce this workflow, the repository must be configured with:
- **Protected `main` & `develop` branches**: Prevent force pushes and deletions.
- **No direct pushes**: All changes to `main` and `develop` must go through a PR.
- **Required Reviews**: Require at least 1 approval on PRs before merging.
- **Status Checks**: Require CI (linting, tests, builds) to pass before merging.

## Security & Secrets

**NEVER commit production secrets, `.env` files, API keys, or credentials.**
The `.gitignore` is configured to block these files. If you accidentally commit a secret, consider it compromised immediately and rotate the key.
