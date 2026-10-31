# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

### Changed

- Agents are cards indented by spawn depth, with tree lines in a gutter left of the cards that run across rows; coloured left-edge stripes removed.
- Finished agents you have not reviewed show *Unreviewed* (neutral) instead of *Ready* (green).
- Connectors that would overlap are drawn on parallel tracks, metro-map style.
- Branch connectors are orthogonal (horizontal/vertical segments with rounded corners).

- Commits are spaced in commit order by default on one axis shared by all repositories, scrolling horizontally through all loaded history; calendar time is a toggle (ADR 0003 amendment).
- Agents are one line (name or alias + status); details appear on hover, by expanding a row (chevron or →/←) or all rows, and in the details panel.
- Spawned-agent tree connectors stay inside the label column and line up with their rows.

- Workbench redesigned around one primary dashboard with optional repositories and details side panels (ADR 0003); the page no longer scrolls, only panels do.
- Review state is a dropdown; tags autocomplete from existing tags; notes keep line breaks.

### Added

- Axis mode *Calendar, compressed*: calendar-proportional gaps with a minimum spacing between commits, so bursts of commits never collide; zoom scales only the time gaps.
- The status badge on an agent card, and in its hover card, opens a menu to set your review state.
- Horizontal zoom of the history axis: −/+ buttons, Ctrl + wheel, or +/−/0 keys.
- *Collapse quiet commits*: runs of uneventful commits fold into a counted pill; hover to list and inspect them, click to expand.
- Branch relationships: *from X* (forked from), *→ X* (merged into) and *at X* (no own commits; dashed pointer to the commit it sits on).
- A legend for every graph mark and colour; richer hover cards for commits, branches, uncommitted changes and agents.
- Commit graph per repository on a timeline: one row per branch, fork/merge edges, pushed vs local-only vs not-pulled commits, uncommitted-changes markers (read-only `git log`, at most 400 commits).
- Agent cards under their branch with workflow status, observed state, activity bars and an optional, truncated, redacted latest-message excerpt (in memory only; Settings → Privacy).
- Spawned agents (Claude Code subagents, Codex sub-threads) as linked child sessions, with a toggle to hide them.
- Filters by harness, last-message time, workflow status, tags and text; repository sorting; details toggle showing alias, tags, full notes and checklist progress on cards.
- Bulk registration from a sortable checklist of repositories found in session folders (`POST /api/v1/repositories/batch`).

### Fixed

- Graph lines no longer show through the gaps between rows of the sticky label column.
- A new pairing link opened in an already-open tab now re-pairs instead of being ignored.
- Newly started agents no longer land behind the per-branch "show more" cutoff.

## [0.1.0] — 2026-10-30

First implementation of the product handoff.

### Added

- Axis mode *Calendar, compressed*: calendar-proportional gaps with a minimum spacing between commits, so bursts of commits never collide; zoom scales only the time gaps.
- The status badge on an agent card, and in its hover card, opens a menu to set your review state.
- Horizontal zoom of the history axis: −/+ buttons, Ctrl + wheel, or +/−/0 keys.
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
