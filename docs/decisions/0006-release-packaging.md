# 0006 — Release packaging: a ready-to-run zip

- Status: accepted (owner request, 2026-10-31)

## Context

The v0.2.0 tag only had GitHub's automatic source archives. Running those needs `npm ci` (every development tool) and `npm run build`. At run time, though, repobs needs only Node.js 24: the server's single npm dependency is `zod`, the web UI is static files, and persistence uses the built-in `node:sqlite`.

## Decision

- Each release publishes **`repobs-<version>.zip`**: the built server, web UI and contracts, the launcher scripts (`npm start`, `npm run open`, `scripts\start.ps1`), `zod`, `LICENSE`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `START-HERE.txt` and `THIRD-PARTY-NOTICES.txt` (licences of every package shipped or bundled into the UI). Unzip and `npm start`; nothing is installed, built or downloaded.
- **`SHA256SUMS.txt`** and release notes (the version's changelog section plus install steps) accompany it; the source archives remain.
- `scripts/package.mjs` (`npm run package`) builds it without extra dependencies: a small zip writer on `node:zlib`, entries sorted, timestamps from the release commit, so the same sources give a byte-identical archive.
- The **Release** workflow (`.github/workflows/release.yml`) runs on `v*` tags: lint, typecheck, unit and integration tests, build, package (refusing a tag that differs from the package version) and `gh release create` with the files. End-to-end tests run in CI on `main` before tagging.
- Not shipped for now: a single executable (larger, and unsigned executables trigger SmartScreen warnings), an installer (repobs runs from a folder), a container (it must read Windows repositories and agent folders), npm packages (the workspaces are private).

## Consequences

- Users need Node.js 24 and Git, as before, but no build tools or network access to install.
- Upgrading is replacing the folder; data stays in `%LOCALAPPDATA%\repobs`.
- `release/` is build output and ignored by Git.
