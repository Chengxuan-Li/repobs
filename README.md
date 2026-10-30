# repobs — observe your Git worktrees and coding agents, locally.

repobs is a local, read-only dashboard for developers with many Git worktrees, temporary agent branches and Claude Code / Codex sessions. One tree shows **repository → branch → worktree → sessions**, each worktree's Git state, each session's observed status *with its evidence*, and your own review notes and checklists. It updates by itself when Git or agent files change.

![repobs overview with synthetic demo data](docs/assets/repobs-overview.png)

*The real application running on synthetic demo data (`npm run demo`).*

**repobs is not** an agent launcher, an IDE, a terminal or a Git client. It never fetches, checks out, commits or otherwise changes your repositories, never edits agent histories or configuration, never installs hooks, and needs no API keys and no VS Code.

## Quick start (Windows)

Requires Node.js 24 LTS (24.11+) and Git for Windows.

```powershell
git clone <actual-repobs-url>   # placeholder: no public remote exists yet
cd repobs
npm ci
npm run build
npm start                       # starts the loopback service, then opens your browser
```

Or: `powershell -ExecutionPolicy Bypass -File scripts\start.ps1` (installs and builds on first run). Click **Add repository**, paste a path such as `C:\src\my-project` (or **Browse…**), and register a second one the same way. Stop with **Ctrl+C**. `npm run open` opens a fresh pairing link for a running instance.

Development: `npm run dev` (backend from sources with watch + Vite dev UI on `http://127.0.0.1:5173`). Documentation: `python -m pip install -r requirements-docs.txt` then `python -m mkdocs serve`.

## What you get

- Registered repositories (identified by their common Git directory), local branches with configured upstreams and ahead/behind, remote-only refs, detached HEADs, all worktrees with staged/unstaged/untracked/conflicted counts, merge/rebase/cherry-pick/revert/bisect markers, locked/prunable/missing states.
- Claude Code and Codex sessions discovered from their local files — including sessions started outside repobs and many per worktree — with observed state (`running`, `awaiting approval`, `idle / turn finished`, `ended`, `unknown`, …), confidence (direct / inferred / unknown), source and evidence time. Missing data is shown as unknown, never idle.
- Your own review layer: review state, tags, alias, autosaved notes and checklists (completed checklists collapse without being deleted), export/import as JSON. Stored only in `%LOCALAPPDATA%\repobs`.
- Live updates over server-sent events, from file watchers plus self-healing polling.
- Optional, off-by-default, read-only GitHub pull request overlay via the GitHub CLI.

## Privacy and security

Loopback only (`127.0.0.1`), launcher pairing with an HttpOnly SameSite=Strict session, Host/Origin/CSRF checks on every route, strict CSP, read-only allowlisted Git commands without a shell, no telemetry and no network use unless you enable the PR lookup. Only structural metadata is read from session files. Details: [docs/privacy-security.md](docs/privacy-security.md) and [SECURITY.md](SECURITY.md).

## Documentation

[Getting started](docs/getting-started.md) · [User guide](docs/user-guide.md) · [Status semantics](docs/status-semantics.md) · [Integrations](docs/integrations.md) · [Limitations](docs/limitations.md) · [Architecture](docs/architecture.md) · [HTTP API](docs/api.md) · [Testing](docs/development/testing.md) · [Progress](docs/development/handoff-status.md)

## License

MIT — see [LICENSE](LICENSE).
