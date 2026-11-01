# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

### Added

- A 25-second product film (an animated illustration, with sound) that opens the documentation landing page, and is linked from the README. It plays by itself, muted, without player controls, and the page waits for it; trying to scroll offers *Skip*, which fades it out and shows the title, as its end does. Scrolling back up plays it again. The page waits only once per session, and never with reduced motion requested.
- The documentation landing page is a product page, in the manner of energyatlas.io: it opens on the film, full window; the header, the product name, a serif tagline and the buttons appear as the page scrolls; then feature rows with real screenshots (rounded, with a glow) and hand-drawn icons, privacy, documentation cards and a closing call to action. No frame, strips or tabs on that page; the header shows section links instead (ADR 0007, amended).

### Changed

- The documentation site takes the shape of the EnergyAtlas documentation sites: two parts (*User guide*, *Developer*), each with an index page in reading order; a landing page with a serif italic line in the headline, two cells and fewer sections; the tab bar and section strips on the page's own surface (ADR 0007, amended).
- The demo repositories have realistic names (`git-status-kit`, `storefront-web`), and the overview screenshot shows the dashboard alone, without side panels or legend.

### Fixed

- After closing a side panel from the toolbar, its button stayed pressed until something else redrew the page.

## [0.3.0] — 2026-11-01

### Added

- **Agent plans in checklists** (ADR 0009). The steps agents keep with their planning tools (Claude desktop app task list, Claude Code `TodoWrite`, Codex `update_plan`) are replayed from the session files into the first section of each checklist, ahead of your own items. You can tick or untick the agent's steps in repobs. Plan text stays in memory. Settings → Privacy turns reading off. Your ticks on the agent's steps need database migration 3; repobs backs up the database before applying it, and earlier versions do not open the migrated database.
- **Automation panel** (View → Panels, Ctrl+Alt+U): rules that set the review state, tags, alias, note or checklist of agents matching conditions on last activity, keywords (title, alias, note, tags, repository, branch, agent type, latest message), review state, tags, harness, activity, checklist and spawning. Each rule applies once per agent and version, shows its matches before saving, and is named in the agent's details (ADR 0008).
- **Outdated** review state.
- **Hidden** filter per view: hide agents by review state, or one at a time with *Hide from this view* in the status menu; list and show them again.
- **Checklist pill** on agent cards and timeline labels: a pie filled clockwise by the share done, then done/total, in the theme's info or success colour; hovering or clicking opens one list where items are ticked and unticked.
- Review states carry a colour dot in the status menu, the Hidden filter and the rule editor.
- The demo data includes two checklists.
- Ready-to-run release download: `repobs-<version>.zip` (built app, launchers and its one runtime dependency; needs only Node.js 24) with `SHA256SUMS.txt`, built by `npm run package` and published by a tag-triggered release workflow (ADR 0006).

### Fixed

- The dashboard showed *Reviewed* as *Complete* and *Flagged* as *Needs review*; every review state now shows as itself, matching the details panel.
- Hover cards followed the pointer inside the item that opened them; they now stay next to that item and move only to stay inside the window.
- No box is marked by a heavy left stripe any more (rule preview, message excerpts, documentation callouts).
- Hovering an agent's card on the timeline showed no details; it now shows the same agent details card as the list.
- A fully ticked checklist no longer collapses behind *All N checklist items complete*; it stays listed.

### Changed

- Database schema version 3. The first start of 0.3.0 copies the database to `repobs.db.bak-v2-<time>` in `%LOCALAPPDATA%\repobs`, then migrates it. Version 0.2.0 does not open the migrated database; to go back, restore that copy.
- The documentation site uses Material for MkDocs in the application's look: light and dark themes, self-hosted Geist fonts, a landing page with a grid of the guides, tabs, breadcrumbs, search and instant navigation (ADR 0007).

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
