# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

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
