# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

## [0.2.0] — 2026-10-31

A redesigned workbench: a commit graph with agents on a shared timeline, several named views, dockable panels and the reference UI's look (ADR 0003, 0004, 0005).

### Added

- **Commit graph per repository** on a timeline: one row per branch, fork and merge edges drawn orthogonally with rounded corners and on parallel tracks where they would overlap (metro style), pushed / local-only / not-pulled commits, uncommitted-change markers and branch relations (*from X*, *→ X*, *at X*); read-only `git log`, at most 400 commits.
- **One axis shared by all repositories**: commit order (default), calendar time, or *calendar, compressed* (time-proportional gaps with a minimum spacing); horizontal zoom (−/+ buttons, Ctrl + wheel, +/−/0); drag with the mouse to pan like a map.
- **Collapse quiet commits**: runs without branching, merging or branch heads fold into a counted pill; hover to list them, click to expand.
- **Agents as one-line cards** under their branch, with workflow status, activity bars, an optional truncated and redacted latest-message excerpt (in memory only; Settings → Privacy) in the hover card and details panel, and a card at the end of each activity bar. The status badge on either card opens a menu to set your review state.
- **Spawned agents** (Claude Code subagents, Codex sub-threads) as cards indented under their parent with tree lines; a chevron with their count shows or hides them, and they start collapsed.
- **Views**: several dashboards as tabs, named *View n* (smallest free number), renamable and closable, each with its own filters, display options, axis and repositories; the repositories panel lists every repository and its ticks follow the current view.
- **Filter bar of dropdowns**: search, Harness and Status (multiple choice), Last message, Tags; Repositories, Branches, Agents and Timeline display options; a legend for every mark.
- **Ribbon**: File (Export, Open, Settings, Diagnostics) and View (Panels, Open new view, Styling, Full screen, Refresh) menus, a command palette (Ctrl+K) and buttons for the side panels and theme.
- **Dockable layout**: panels and views can be dragged, split, collapsed, closed, maximized and reset; the arrangement is remembered per browser; side panels keep a minimum width.
- **File → Export / Open**: annotations and views (names, settings, arrangement) in one JSON file, without transcript content.
- Bulk registration from a sortable checklist of repositories found in session folders (`POST /api/v1/repositories/batch`).

### Changed

- The workbench is one dockable layout around the views; the page never scrolls, only panels do. The overview, tree and per-entity views of 0.1.0 are replaced by the dashboard, the repositories panel and the details panel.
- Labels and panel titles use the interface sans in sentence case; buttons and fields follow the reference control style.
- Finished agents you have not reviewed show *Unreviewed* (neutral) instead of *Ready*.
- Review state is a dropdown; tags autocomplete from existing tags; notes keep line breaks.

### Fixed

- Graph lines no longer show through the gaps between rows of the sticky label column.
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
