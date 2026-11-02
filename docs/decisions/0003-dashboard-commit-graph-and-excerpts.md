# 0003 — Dashboard workbench, commit graph and latest-message excerpts

- **Status:** Accepted (owner feedback, 2026-10-30)
- **Supersedes:** parts of [0001](0001-product-foundation.md) and the handoff's out-of-scope list (no commit graph; preview limited to structural labels)

## Decisions

1. **One primary working panel.** The center of the workbench is a dashboard of the registered repositories. It replaces the former tree sidebar plus detail pane. Side panels are optional: a repository list on the left and a details/notes panel on the right.
2. **Branches as a commit graph on a timeline.** Each repository shows one row per branch; commits are nodes placed by commit time, edges are parent links, so forks and merges between branch rows are visible (a Git-tree / Gantt hybrid). The branch name sits at its head. Uncommitted or untracked changes appear as a distinct node after the head; commits that exist only locally (not on any remote-tracking ref) are drawn differently from pushed ones.
3. **Agents as cards under their branch.** Every session is a card row under the branch/worktree it ran in, with a bar spanning its first to last activity on the same time axis. Agents spawned by another agent (Claude Code subagents, Codex sub-threads) are shown connected to their parent and can be hidden with one toggle.
4. **Latest-message excerpt.** Cards show a short excerpt of the agent's latest message or current activity (for example the tool it is running and the tool's own description), read mechanically from the provider files. No LLM or summarization. Excerpts are truncated, have obvious secret patterns redacted, are held in memory only (never stored in the database or exports), and can be switched off in Settings (*Privacy → Show latest message excerpts*, on by default).
5. **Filters and sorting.** Dashboard filters by harness (Claude Code / Codex), time of the last message (for example within 2, 3, 7, 14 or 40 days), status (working, needs input, needs review, ready, complete, unknown) and tags; repositories sort by last activity, active sessions or name.
6. **Bulk registration.** Repositories can be registered several at a time from a checklist of candidates (sorted by last session activity or session count), in addition to entering a path.
7. **Simpler notes.** Review state is a dropdown; tags autocomplete from existing tags; notes are plain text with line breaks preserved. A dashboard toggle shows alias, tags, full notes and checklist progress on each card.

## Consequences

- The Git allowlist gains exactly one read-only command: `git log -z` with a fixed format, a bounded `--max-count`, `--branches`, `--remotes` and explicit commit ids for detached heads. It is tested like the other commands and never writes.
- Commit subjects become visible in the UI (tooltips). They are local repository data, shown only to the paired browser.
- Session ids for Claude subagents take the form `claude:<session-id>__agent-<agent-id>`; their annotations are independent of the parent's.
- The keyboard model moves from a tree to a list of focusable rows with arrow-key navigation.

## Amendment (owner feedback, 2026-10-30, second review)

- **Commit-order axis by default.** Commits are evenly spaced in time order rather than placed by calendar time; calendar time remains available as a toggle. The axis is shared by all repositories and scrolls horizontally back through all loaded history (the default range is everything loaded, not the last week).
- **One line per agent.** Rows show only the name (or alias) and workflow status; details are in a hover card, an expandable block (per agent, or all at once) and the details panel.
- **Visible branch relationships.** Labels and lanes show where a branch forked from, where it was merged into, and which branch's commit a branch without its own commits points at.
- **A legend** explains every graph mark and colour.

## Amendment (owner feedback, 2026-10-30, third review)

- **Orthogonal connectors.** Lines between branches use horizontal and vertical segments with rounded corners instead of free-form curves.
- **Collapsible quiet commits (optional, off by default).** Runs of two or more commits along one branch with no head, fork, merge, first-own-commit or nearby agent activity fold into one counted node that takes a single axis column; hovering lists the commits (each inspectable), clicking expands the run.

## Amendment (owner feedback, 2026-10-30, fourth review)

- **Agents are cards indented by spawn depth.** Spawn-tree lines are drawn in a gutter left of the cards and pass through row boundaries (per-row guide segments computed in the layout), so a parent connects to every child. No coloured left-edge status stripes; status is the badge.
- **Finished, unreviewed agents are "Unreviewed"** (neutral), replacing "Ready" (success green), which contradicted an unreviewed review state.
- **The status badge is the review control.** It opens a review-state menu on the dashboard row and in the agent's hover card; the hover card opens beside the label column so the pointer can reach it.
- **Metro-style connector tracks.** Overlapping collinear connector legs get parallel tracks 4 px apart (`routing.ts`): lanes keep the centre; a leg that turns later sits closer to the centre and others step outwards on the side they turn to, so a bundle leaving one commit does not cross itself; when a side is full (4 tracks) the other side is used.
- **Horizontal zoom** (25%–1600%) of the shared axis, by buttons, the mouse wheel (anchored at the pointer; Ctrl + wheel before [ADR 0010](0010-ui-size-and-wheel-controls.md)) or +/−/0 keys; stored with the per-browser view.

## Amendment (owner feedback, 2026-10-30, fifth review)

- **Calendar, compressed axis (experimental, opt-in).** A third axis mode: items in time order, each gap `max(minimum spacing, elapsed time × scale)`, where the scale at 100% is the plain calendar scale for the window and zoom multiplies only the scale. Plain calendar time stays linear (honest distances, collisions possible); commit order stays the default. Ticks on the non-linear axis are placed by importance (now, year, month, day, 6 h, hour) with a 72 px minimum distance.

## Amendment (owner feedback, 2026-10-30, sixth review)

- **Quiet means quiet in the Git sense.** Agent activity no longer keeps commits visible: a commit stays visible only as a branch tip or head, a fork base or merge endpoint, a merge, or a branch's first own commit. Consecutive commits an agent makes on one branch fold like any other run. (The earlier rule — any agent active on the branch within 5 minutes — kept nearly everything visible on real data, because sessions span days from first to last message.)

## Amendment (owner decision, 2026-10-30, seventh review)

- **Agent labels in the chronology (trial).** Each activity bar ends with the agent's name, workflow status and last-activity age, placed after the bar or, near the right edge of the axis, before it. The label marks the last *message*, not a commit: repobs does not attribute commits to agents.
- **Two independent toggles**, both on by default: *Agent labels on timeline* and *Agent names in list*. Without names in the list the label column narrows (360 → 230 px) and keeps the spawn tree, provider mark and status/review menu, which stay in the fixed column because they rely on it (keyboard navigation, selection, the review menu).

## Amendment (owner feedback, 2026-10-31, eighth review)

- **No details on the dashboard.** Agent cards stay one line: the expanded block (state, excerpt, tags, notes) and *Expand agent details* are removed; that information is in the hover card and the details panel.
- **The chevron is for spawned agents only.** It appears only on an agent that spawned others, with their count while hidden, and shows or hides them (also → / ←). Spawned agents start hidden (*Agents → Collapse spawned agents*, on by default); per-parent choices are exceptions to that switch and reset when it changes, like expanded quiet-commit groups. This replaces *Hide spawned agents*.
- **The timeline label is a card.** The agent's label at the end of its bar is an HTML card styled like the list card — provider mark, name, last-activity age and the status badge with the same review menu — placed after the bar or before it near the axis end, in a layer above the lanes and under the sticky label column. Its review buttons are out of the tab order; the list card's menu is the keyboard route.
