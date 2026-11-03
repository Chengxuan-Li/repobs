# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

## [0.4.0] — 2026-11-03

### Added

- **Help menu**: *Help → Legend and controls* (also in Search commands) opens one dialog with every mark on the dashboard, the three timeline modes and the mouse and keyboard controls; it replaces the *Legend* button and bar of each view. The menu also links to the tutorial, the documentation, the GitHub repository, releases and a new issue.
- **Tutorial**: the user guide's *Getting started* and *Using repobs* pages are now a tutorial in five chapters (install and add projects, read the dashboard, follow your agents, review and take notes, arrange your workspace), with screenshots of each step in both themes, made by `tests/e2e/docs-tutorial.spec.ts` on synthetic data.
- **Live wheel zoom**: the history is redrawn while you zoom, at most once per frame, keeping the moment under the pointer in place on every axis; each agent's ticks, spans and marks are drawn as a few paths instead of one element each (a large view went from about 19,000 to 7,000 elements, a redraw from about 100 to 50 ms). Zooming a large view can still look jumpy.
- **What an agent did**: each agent's line is solid where it was working and dotted between, with a tick per tool call; zoom to 300 % or more (or *Agents → Activity detail*) for its steps on the same line — model time (with thinking), tool calls by kind, failed calls, prompts, compactions, Git changes ◆ and inspections ○. Hover cards and the details panel sum it up a line per field: tools, commands and time as proportional bars (click one for each part's amount, again for its share), then tokens in and out, cache hit rate and current context. *Agents → Agent line → Height: context used* makes agent lines as tall as their context was full. Agent cards in the lanes open after a 0.5 s pause; the label column opens them at once. An agent active only before the history range shows a ◂ mark at the left edge and its card, instead of an empty lane; a line that began before the range starts with ◂ instead of being cut flat with its earlier steps piled at the edge. Counted on demand from the agents' own files; only tool names, allowlisted command names, times, outcomes and token counts are kept, in memory (ADR 0013). *Settings → Privacy → Read agents’ activity* turns it off.
- Folders without Git: add a folder to see the Claude Code and Codex agents working in it on the shared timeline, under one *Folder* row with no commits (ADR 0011). *Add* suggests session working directories outside Git as folders; a typed path that Git does not recognise offers *Add as folder*. Registered repositories inside a folder keep their own agents. Drive roots, your home folder and folders inside a repository are refused. repobs reads nothing in a folder beyond whether it exists, and reports a folder that became a Git repository without converting it. Upgrading migrates the database to schema v4 (backed up first); 0.3.0 cannot read it.
- A 25-second product film (an animated illustration, with sound) that opens the documentation landing page. It plays by itself, muted, without player controls, and the page waits for it; trying to scroll offers *Skip*, which fades it out and shows the title, as its end does. Scrolling back up plays it again. The page waits only once per session; the film starts by itself whatever the motion preference.
- The documentation landing page is a product page, in the manner of energyatlas.io: it opens on the film, full window; the header, the product name, a serif tagline and the buttons appear as the page scrolls; then feature rows with real screenshots (rounded, with a glow) and hand-drawn icons, privacy, documentation cards and a closing call to action. No frame, strips or tabs on that page; the header shows section links instead (ADR 0007, amended).

- **Interface size** (ADR 0010): Ctrl + mouse wheel, Ctrl + = / − / 0 or *View → Styling* make the whole interface larger or smaller in 10 % steps (50–200 %), in place of the browser's zoom. It is kept per browser; the status bar shows it when it is not 100 % and resets it on click.

### Changed

- The mouse wheel over the dashboard zooms the history around the pointer, 10 % per notch (it was Ctrl + wheel), instead of scrolling; drag to move through it. Sideways swipes on a touchpad and Shift + wheel still scroll sideways. Text in the dashboard can no longer be selected, so a drag never selects.
- The documentation site takes the shape of the EnergyAtlas documentation sites: two parts (*User guide*, *Developer*), each with an index page in reading order; a landing page with a serif italic line in the headline, two cells and fewer sections; the tab bar and section strips on the page's own surface (ADR 0007, amended).
- The demo repositories have realistic names (`git-status-kit`, `storefront-web`), and the overview screenshot shows the dashboard alone, without side panels or legend.
- Notices (a repository removed, a refresh, a file opened, a failed action, a lost connection) float above the status bar instead of pushing the workbench down. A confirmation leaves by itself after 8 seconds, but not while the pointer or focus is on it; a failure stays until dismissed.
- Every screenshot also comes in the dark theme: the landing page and the README show the one matching the reader's theme.

### Fixed

- Agents showed *Needs input* while a tool was simply running (a test run, a build, a long command). Only an explicit question now needs you: Claude Code's `AskUserQuestion` or `ExitPlanMode`, or Codex's blocking `request_user_input`. A running tool shows *Working*, with *tool running or awaiting permission* only where the session can prompt for permission.
- *Commit order* and *Calendar, compressed* stacked the agents of a folder without Git at one point, and squeezed agents that ran before the first commit or between two distant commits into one gap. Each agent's first and last activity now takes its own place on those axes, like a commit (ADR 0003, amended).
- Codex history: most Codex threads were missing, because Codex 0.166 compresses older rollouts (`rollout-*.jsonl.zst`) and repobs read only plain ones. Compressed rollouts are now read in memory, over the first scans after start, with the same state, excerpt and plan rules. Codex's `state_5.sqlite` thread index is read read-only for thread names and lists threads without a readable rollout as *Unknown · only thread metadata is available*; it never reads prompt columns and never creates files or takes blocking locks in the Codex home (ADR 0012). Codex working directories lose their `\\?\` prefix.
- A forked Codex sub-agent's rollout was credited to its parent thread, whose `session_meta` it repeats after its own; the sub-agent now appears as its own session.
- A Claude Code session whose last reply is a failed API call (a run that could not sign in, a rate limit, a server error) showed as *Idle / turn finished*; it now shows *Error*, inferred from the transcript, until the next prompt. The same applies to subagents.
- Claude Code task plans using `TaskCreate` and `TaskUpdate` now appear in agent checklists. Successful results supply task ids and confirmed changes; long-transcript and subagent recovery preserves earlier task creations.
- After closing a side panel from the toolbar, its button stayed pressed until something else redrew the page.
- **Browse…** in *Add repositories* could appear to do nothing: the legacy folder dialog sometimes closed itself as *Cancel* within two seconds, and any failure was also reported as a cancel. It now uses the Windows shell folder dialog, opens in front on the monitor where you clicked, and every outcome shows in the page: the chosen folder, *closed without choosing a folder*, or the error. While it is open the page says so and offers *Stop waiting*, which closes it.

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
