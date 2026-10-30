# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

### Changed

- Workbench redesigned around one primary dashboard with optional repositories and details side panels (ADR 0003); the page no longer scrolls, only panels do.
- Review state is a dropdown; tags autocomplete from existing tags; notes keep line breaks.

### Added

- Commit graph per repository on a timeline: one row per branch, fork/merge edges, pushed vs local-only vs not-pulled commits, uncommitted-changes markers (read-only `git log`, at most 400 commits).
- Agent cards under their branch with workflow status, observed state, activity bars and an optional, truncated, redacted latest-message excerpt (in memory only; Settings → Privacy).
- Spawned agents (Claude Code subagents, Codex sub-threads) as linked child sessions, with a toggle to hide them.
- Filters by harness, last-message time, workflow status, tags and text; repository sorting; details toggle showing alias, tags, full notes and checklist progress on cards.
- Bulk registration from a sortable checklist of repositories found in session folders (`POST /api/v1/repositories/batch`).

### Fixed

- A new pairing link opened in an already-open tab now re-pairs instead of being ignored.
- Newly started agents no longer land behind the per-branch "show more" cutoff.

## [0.1.0] — 2026-10-30

First implementation of the product handoff.

### Added

- Loopback Node.js service with launcher pairing, signed session cookies, Host/Origin/CSRF protection and a strict CSP.
- Read-only Git reader with an allowlist: repository identity by common Git directory, worktrees (locked/prunable/missing), local/remote-tracking/remote-only refs, configured upstreams with ahead/behind and gone detection, working-tree status and operation markers.
- Claude Code adapter (transcripts, subagents, live-session registry) and Codex adapter (multi-file rollouts, thread index, subagents) with incremental bounded reading and evidence-based status.
- Session-to-worktree association with unassigned and source-missing handling.
- Monitor with file watchers, adaptive polling, reconciliation and versioned SSE diffs.
- SQLite persistence (`node:sqlite`) with migrations, backups and corruption recovery.
- Human annotations: review state, tags, alias, notes, checklists with completed-collapse, JSON export/import.
- React workbench: accessible virtualized tree, overview/attention queue, repository/branch/worktree/session views, inspector, settings, diagnostics, light/dark/system themes.
- Optional read-only GitHub pull request overlay through the GitHub CLI (off by default).
- `npm start` / `scripts/start.ps1` launcher, `npm run dev`, synthetic demo builder.
- Unit, integration and Playwright tests; CI on Windows and Ubuntu; MkDocs documentation and GitHub Pages workflow.
