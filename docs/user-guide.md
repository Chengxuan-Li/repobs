# User guide

## The workbench

- **Ribbon** (top): repositories-panel toggle, **Add repositories**, Diagnostics, theme (system → light → dark), Settings, details-panel toggle.
- **Dashboard** (center, always open): one section per repository with its branches, commits and agents on a shared timeline. This is the primary working panel.
- **Repositories panel** (left, optional, resizable): which repositories are shown on the dashboard, their agent counts and last activity; click a name to jump to it, untick to hide it, **×** to remove it from repobs (no files are touched).
- **Details panel** (right, optional, resizable): evidence and your notes for the selected agent, or upstream/worktree/status details for the selected branch.
- **Status bar** (bottom): counts, last sync time, live connection state, and a *Monitoring degraded* link when something needs attention.

Only the panels scroll; the page itself never does. Panel widths, filters, toggles, hidden/collapsed repositories, the selection and the theme are remembered.

## Adding repositories

**Add repositories** opens a checklist of candidates: repositories found in the working directories of your existing Claude Code and Codex sessions (repobs never scans your disk), with their session count, active sessions and last activity. Sort by last activity, active sessions, session count or path; tick several (or *Select all*) and add them at once. You can also type a path (any folder inside a repository, including a linked worktree) and press **Add to list**, or use **Browse…** for the native Windows folder chooser. Each path reports success or its own error (not a repository, already registered, …).

## Reading a repository

```text
COMMITS IN ORDER →       Oct 25        Oct 26        Oct 27   now
repo-a
main                     ●─────────────────────────────────◇    branch row: commits in order
 › C Tighten status parser          Needs input           ▮    one line per agent
 › X Review ref grouping            Needs review          ▮
feature/tracked from main   ╰──○                                forked from main; ○ = not pushed
 › C Claude session c3d2e4f6        Working               ▬
   └ › C Map the feature module     Needs input           ▮    spawned by the agent above
unicode-branch at main   ┊○                                     no commits of its own: points at a main commit
```

Click **Legend** in the filter bar for the meaning of every mark.

- **One row per branch.** Local branches come first (the primary checkout's branch at the top, then other checked-out branches, then the rest by newest commit), then detached worktrees, *Unassigned sessions*, and — if *Remote-only branches* is ticked — remote refs without a local branch. The *Branches* menu shows all, only checked-out ones, or only branches with agents.
- **Relationships are spelled out.** The label says *from main* when a branch's first own commit was made on top of `main`, *→ main* when it was merged into `main`, and *at main* when it has no commits of its own and points at a commit on `main`. On the lanes, forks and merges are curves between rows and "at" branches get a dashed pointer to the commit they sit on.
- **Commits are nodes, parent links are edges.** A commit sits on the row of the first branch that reaches it along first parents; commits reached only through merges of deleted branches are drawn on the merging row.
- **Node styles:** filled = on a remote-tracking ref (pushed); hollow amber with dashed edges = only local, not pushed; grey dashed = on the upstream but not pulled yet; hollow blue = a branch pointer; the dashed **diamond** after a head = uncommitted or untracked changes in that branch's worktree (red when conflicted). A small square above a head marks an open pull request (when the GitHub integration is on).
- **Hover** any commit for its subject, id, date, branch and push state; any branch label or pointer for its upstream, relations and worktree; any diamond for the change counts; any agent row or bar for the agent's details.

### The shared axis

All repositories share one horizontal axis, labelled at the top; scroll sideways to go back through history (the view opens at the newest end).

- **Axis → Commit order** (default): commits from every visible repository are evenly spaced in the order they were made; dates are labels, not distances. Agent bars sit between the commits made around the same time.
- **Axis → Calendar time**: distances are proportional to elapsed time.
- **History** limits how far back the axis goes (24 hours … 1 year, or everything loaded — the newest 400 commits per repository).

## Agents

Each Claude Code or Codex session is **one line** under the branch whose worktree it ran in, newest first: an expand chevron, a provider mark (**C** = Claude Code, **X** = Codex), the name (your alias if you set one, else the provider title or a fallback such as *Claude session 1a2b3c4d*) and its **workflow status** — *Needs input*, *Working*, *Needs review*, *Ready*, *Complete* or *Unknown* (see [Status semantics](status-semantics.md)). Its bar on the lanes runs from its first to its last activity, coloured by that status.

Everything else is collapsed:

- **Hover** the row or its bar for the observed state and why, last activity, the **latest message excerpt** (the agent's last reply, or the tool it is running with the tool's own description), review state, tags, notes and checklist progress.
- **Expand** one agent with its chevron (or → on the keyboard; ← collapses), or all agents with **Expand agent details**. The expanded block shows the state, the excerpt, a review dropdown, tags and full notes (line breaks kept).
- **Select** it (click its name, or Enter) to open it in the details panel.

Excerpts are read mechanically from the provider's files, truncated, with obvious secrets redacted, and never stored; Settings → Privacy turns them off.

Spawned agents (Claude Code subagents, Codex sub-threads) are indented under the agent that started them with a tree connector, and linked to it on the lanes; **Hide spawned agents** removes them. Long lists show the 12 newest agents per branch and a *Show N more agents* row.

## Your notes

Select an agent (click its name, or use the keyboard) to open it in the details panel:

- **Review state** dropdown: Unreviewed, Needs review, Reviewed, Complete, Flagged.
- **Display alias**.
- **Tags** with autocomplete: start typing and existing tags are suggested (most used first); **Tab** or **Enter** takes the highlighted one, **↑/↓** move, **Backspace** in an empty field removes the last tag.
- **Notes**: plain text; Enter starts a new line, and line breaks are shown on the card.
- **Checklist**: add, tick, reorder, delete. When every item is done it collapses to *All N checklist items complete*; **Show completed** brings it back. Nothing is deleted unless you delete it.

Everything saves automatically to the local repobs database. Notes belong to the agent session: they survive restarts, removal of the repository from the dashboard, deletion of the worktree and disappearance of the provider's file. **Clear annotations…** deletes a session's notes after confirmation; Settings → Annotations exports or imports them as JSON.

## Filters

- **Search**: titles, aliases, tags, session ids and the latest message excerpt.
- **Harness**: Claude Code / Codex.
- **Last message**: any time, or within 24 hours, 2, 3, 7, 14 or 40 days.
- **Status**: any combination of the workflow statuses.
- **Tags**: any of the chosen tags (with the same autocomplete).
- **Sort repos** by last activity, active agents, name or manual order.

**Clear filters** resets them. Filters apply to agents; branches stay visible according to the *Branches* menu.

## Keyboard

| Key | Action |
| --- | --- |
| Tab to the dashboard, then ↓ | Focus the first row |
| ↑ / ↓, Home / End | Move between branch and agent rows across repositories |
| → / ← | Expand / collapse the focused agent |
| Enter or Space | Select the row (opens it in the details panel) |
| Esc | Close dialogs and suggestion lists |
| ← / → on a panel divider | Resize the panel |

## Removing a repository

In the repositories panel, **×** → **Remove from dashboard**. This only removes the entry from repobs; no files, branches or worktrees are touched and your session notes are kept.
