# repobs — observe your Git worktrees and coding agents, locally.

repobs is a local, read-only dashboard for developers with many Git worktrees, temporary agent branches and Claude Code / Codex sessions. A dashboard shows each repository's **branches as a commit graph on a timeline** — forks, merges, unpushed commits, uncommitted work — with the **agents that worked on each branch as cards** (status with its evidence, latest message excerpt, spawned sub-agents) and your own review notes, tags and checklists. It updates by itself when Git or agent files change.

![repobs dashboard with synthetic demo data](docs/assets/repobs-overview.png)

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

Or: `powershell -ExecutionPolicy Bypass -File scripts\start.ps1` (installs and builds on first run). Click **Add repositories** and tick the repositories repobs found in your agent sessions, or add a path such as `C:\src\my-project` (or **Browse…**); several can be added at once. Stop with **Ctrl+C**. `npm run open` opens a fresh pairing link for a running instance.

Development: `npm run dev` (backend from sources with watch + Vite dev UI on `http://127.0.0.1:5173`). Documentation: `python -m pip install -r requirements-docs.txt` then `python -m mkdocs serve`.

## What you get

- Registered repositories (identified by their common Git directory), local branches with configured upstreams and ahead/behind, remote-only refs, detached HEADs, all worktrees with staged/unstaged/untracked/conflicted counts, merge/rebase/cherry-pick/revert/bisect markers, locked/prunable/missing states.
- A commit graph per repository: one row per branch on an axis shared by all repositories (commit order, calendar time or compressed calendar; zoom, and drag to pan), fork/merge edges on parallel tracks, pushed vs local-only commits, uncommitted-change markers, and quiet commits folded into counted groups on request.
- Claude Code and Codex sessions discovered from their local files — including sessions started outside repobs, many per worktree, and the sub-agents they spawned (collapsible under their parent) — as cards with observed state, confidence (direct / inferred / unknown), source and evidence time, and an optional redacted excerpt of the latest message. Missing data is shown as unknown, never idle.
- Several named views, each with its own filters (harness, status, last-message time, tags, text), display options and repositories; a dockable layout with repositories and details panels; File → Export / Open for your annotations and views.
- Your own review layer: review-state dropdown, autocompleting tags, alias, multi-line autosaved notes and checklists (completed checklists collapse without being deleted), export/import as JSON. Stored only in `%LOCALAPPDATA%\repobs`.
- Live updates over server-sent events, from file watchers plus self-healing polling.
- Optional, off-by-default, read-only GitHub pull request overlay via the GitHub CLI.

## Privacy and security

Loopback only (`127.0.0.1`), launcher pairing with an HttpOnly SameSite=Strict session, Host/Origin/CSRF checks on every route, strict CSP, read-only allowlisted Git commands without a shell, no telemetry and no network use unless you enable the PR lookup. Only structural metadata is read from session files, plus an optional, truncated, redacted excerpt of each agent's latest message that is never stored. Details: [docs/privacy-security.md](docs/privacy-security.md) and [SECURITY.md](SECURITY.md).

## Documentation

[Getting started](docs/getting-started.md) · [User guide](docs/user-guide.md) · [Status semantics](docs/status-semantics.md) · [Integrations](docs/integrations.md) · [Limitations](docs/limitations.md) · [Architecture](docs/architecture.md) · [HTTP API](docs/api.md) · [Testing](docs/development/testing.md) · [Progress](docs/development/handoff-status.md)

## License

MIT — see [LICENSE](LICENSE).
