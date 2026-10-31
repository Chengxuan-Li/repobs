# User guide

## The workbench

- **Ribbon** (top): the **Repositories**, **View** and **Tools** menus; **Search commands** (Ctrl+K), which finds and runs any command by typing part of its name; and icon buttons for Add repositories, the repositories and details panels, Maximize dashboard, Reset layout, Full screen, theme (system → light → dark), Diagnostics and Settings.
- **Dashboard** (centre tab, always open): one section per repository with its branches, commits and agents on a shared timeline. This is the primary working panel.
- **Repositories panel** (left side bar by default): which repositories are shown on the dashboard, their agent counts and last activity; click a name to jump to it, untick to hide it, **×** to remove it from repobs (no files are touched).
- **Details panel** (right side bar by default): evidence and your notes for the selected agent, or upstream/worktree/status details for the selected branch. Selecting an agent or branch opens it if it is hidden.
- **Status bar** (bottom): counts, last sync time, live connection state, and a *Monitoring degraded* link when something needs attention.

### Arranging the panels

The panels dock like an IDE's:

- Click a panel's name in a side bar to collapse or expand it; drag the edge between panels to resize.
- **Drag** a panel's tab beside the dashboard, into the other side bar, or onto the dashboard's tab strip; the drop target is outlined while you drag. An empty side bar still accepts panels.
- Close a docked panel with its **×**; bring it back from **View → Repositories panel / Details panel**, the ribbon buttons, or Ctrl+B / Ctrl+Alt+B.
- **Maximize dashboard** collapses the open panels to give the history the whole window; press it again to bring them back.
- **Reset layout** restores the default arrangement.

Only the panels scroll; the page itself never does. The arrangement, filters, toggles, hidden/collapsed repositories, the selection and the theme are remembered in this browser.

## Adding repositories

**Add repositories** opens a checklist of candidates: repositories found in the working directories of your existing Claude Code and Codex sessions (repobs never scans your disk), with their session count, active sessions and last activity. Sort by last activity, active sessions, session count or path; tick several (or *Select all*) and add them at once. You can also type a path (any folder inside a repository, including a linked worktree) and press **Add to list**, or use **Browse…** for the native Windows folder chooser. Each path reports success or its own error (not a repository, already registered, …).

## Reading a repository

```text
COMMITS IN ORDER →       Oct 25        Oct 26        Oct 27   now
repo-a
main                     ●─────────────────────────────────◇    branch row: commits in order
 [› C Tighten status parser   Needs input ⌄]              ▮    one card per agent
 [› X Review ref grouping     Needs review ⌄]             ▮
feature/tracked from main   ╰──○                                forked from main; ○ = not pushed
 [› C Claude session c3d2e4f6 Working ⌄]                  ▬
  ├ [› C Map the feature module  Needs input ⌄]           ▮    spawned agents: indented cards
  └ [› C Draft the test plan     Unreviewed ⌄]            ▮
unicode-branch at main   ┊○                                     no commits of its own: points at a main commit
```

Click **Legend** in the filter bar for the meaning of every mark.

- **One row per branch.** Local branches come first (the primary checkout's branch at the top, then other checked-out branches, then the rest by newest commit), then detached worktrees, *Unassigned sessions*, and — if *Remote-only branches* is ticked — remote refs without a local branch. The *Branches* menu shows all, only checked-out ones, or only branches with agents.
- **Relationships are spelled out.** The label says *from main* when a branch's first own commit was made on top of `main`, *→ main* when it was merged into `main`, and *at main* when it has no commits of its own and points at a commit on `main`. On the lanes, connectors are straight lines with rounded corners: a fork drops vertically from its base commit and turns into the branch row, a merge runs along its branch and turns into the merge commit, and "at" branches get a dashed pointer to the commit they sit on. Like lines on a metro map, connectors that would share a path — several branches leaving one commit, a merge running along its branch's own lane — are drawn on parallel tracks a few pixels apart, so each stays distinguishable.
- **Commits are nodes, parent links are edges.** A commit sits on the row of the first branch that reaches it along first parents; commits reached only through merges of deleted branches are drawn on the merging row.
- **Node styles:** filled = on a remote-tracking ref (pushed); hollow amber with dashed edges = only local, not pushed; grey dashed = on the upstream but not pulled yet; hollow blue = a branch pointer; the dashed **diamond** after a head = uncommitted or untracked changes in that branch's worktree (red when conflicted). A small square above a head marks an open pull request (when the GitHub integration is on).
- **Hover** any commit for its subject, id, date, branch and push state; any branch label or pointer for its upstream, relations and worktree; any diamond for the change counts; any agent row or bar for the agent's details.

### Collapsing quiet commits

Tick **Collapse quiet commits** to fold runs of commits that are quiet in the Git sense — no branch head, no fork or merge, not the first commit of a branch — into one pill showing how many commits it hides. A burst of commits an agent made on one branch counts as quiet, as long as nothing branches off or merges in between. Hover a pill to list its commits (newest first); move onto the list and hover a commit for its subject, id, date and push state. Click the pill, or **Show these commits on the graph**, to expand that run. Unticking the box shows everything; ticking it again re-collapses all runs.

### The shared axis

All repositories share one horizontal axis, labelled at the top; scroll sideways to go back through history (the view opens at the newest end).

- **Timeline → Commit order** (default): commits from every visible repository are evenly spaced in the order they were made; dates are labels, not distances. Agent bars sit between the commits made around the same time.
- **Timeline → Calendar time**: distances are proportional to elapsed time. Commits made close together can overlap.
- **Timeline → Calendar, compressed**: gaps follow elapsed time, but commits made close together are pushed apart to a minimum spacing, so a burst of commits stays readable. Distances are only proportional between well-separated commits; date labels mark where days and months start. Zooming stretches or shrinks the time gaps, never below that minimum spacing.
- **Timeline → History** limits how far back the axis goes (24 hours … 1 year, or everything loaded — the newest 400 commits per repository).
- **Zoom** stretches or compresses the axis horizontally: the **−** / **+** buttons at the left of the axis, **Ctrl + mouse wheel** over the dashboard (zooms around the pointer), or **+**, **−** and **0** (reset) while the dashboard has focus. The percentage button resets to 100%. Zooming out below 100% only packs commits closer when history is wider than the window.

## Agents

Each Claude Code or Codex session is a **one-line card** under the branch whose worktree it ran in, newest first: an expand chevron, a provider mark (**C** = Claude Code, **X** = Codex), the name (your alias if you set one, else the provider title or a fallback such as *Claude session 1a2b3c4d*) and its **workflow status** — *Needs input*, *Working*, *Needs review*, *Unreviewed*, *Complete* or *Unknown* (see [Status semantics](status-semantics.md)). Its bar on the lanes runs from its first to its last activity, coloured by that status.

**Click the status** to set your review state from a menu (Unreviewed, Needs review, Reviewed, Complete, Flagged); the same menu is in the agent's hover card. A finished agent you have not reviewed shows *Unreviewed*, never a success colour.

Everything else is collapsed:

- **Hover** the row or its bar for the observed state and why, last activity, the **latest message excerpt** (the agent's last reply, or the tool it is running with the tool's own description), review state, tags, notes and checklist progress. The row's card opens beside the label column; move onto it to use its review menu.
- **Expand** one agent with its chevron (or → on the keyboard; ← collapses), or all agents with **Expand agent details**. The expanded block shows the state, the excerpt, tags and full notes (line breaks kept).
- **Select** it (click its name, or Enter) to open it in the details panel.

Excerpts are read mechanically from the provider's files, truncated, with obvious secrets redacted, and never stored; Settings → Privacy turns them off.

**Where agent names appear** — two independent toggles in the **Agents** dropdown:

- **Agent labels on timeline** (on by default): each agent's bar ends with its name, status and how long ago it was last active, so you read who worked when right in the history. Near the right edge the label moves to the left of the bar. Hovering a label shows the agent's card.
- **Agent names in list** (on by default): the names in the label column. Turn it off to give the history more room: the column narrows and each card keeps its provider mark, spawn-tree position and status menu.

Either, both or neither can be on; with both off, hover a card or bar to see who it is.

Spawned agents (Claude Code subagents, Codex sub-threads) are cards indented one step per spawn level under the agent that started them. The tree lines run in the gutter left of the cards and continue across rows, from the bottom of the parent's card to each child; on the lanes, a thin line links the parent's bar to its children's; **Hide spawned agents** removes them. Long lists show the 12 newest agents per branch and a *Show N more agents* row.

## Your notes

Select an agent (click its name, or use the keyboard) to open it in the details panel:

- **Review state** dropdown: Unreviewed, Needs review, Reviewed, Complete, Flagged.
- **Display alias**.
- **Tags** with autocomplete: start typing and existing tags are suggested (most used first); **Tab** or **Enter** takes the highlighted one, **↑/↓** move, **Backspace** in an empty field removes the last tag.
- **Notes**: plain text; Enter starts a new line, and line breaks are shown on the card.
- **Checklist**: add, tick, reorder, delete. When every item is done it collapses to *All N checklist items complete*; **Show completed** brings it back. Nothing is deleted unless you delete it.

Everything saves automatically to the local repobs database. Notes belong to the agent session: they survive restarts, removal of the repository from the dashboard, deletion of the worktree and disappearance of the provider's file. **Clear annotations…** deletes a session's notes after confirmation; Settings → Annotations exports or imports them as JSON.

## Filters and view options

The bar above the dashboard has the filters on the left and the view options on the right; each dropdown shows its current value, and a filter that narrows the list shows its value in the accent colour.

**Filters** (which agents are shown):

- **Search**: titles, aliases, tags, session ids and the latest message excerpt.
- **Harness**: *Any harness*, or tick one or more of Claude Code and Codex. Ticking every harness is the same as *Any*.
- **Status**: *Any status*, or tick any combination of the workflow statuses.
- **Last message**: any time, or within 24 hours, 2, 3, 7, 14 or 40 days.
- **Tags**: type to pick tags (with the same autocomplete as the notes); agents with any of them are shown.

The agent count follows the filters, and **Clear filters** resets them. Filters apply to agents; branches stay visible according to the *Branches* dropdown.

**View options** (how the history is drawn):

- **Branches**: all branches, checked-out ones, or branches with agents; *Remote-only branches*; *Collapse quiet commits*.
- **Agents**: *Hide spawned agents*, *Expand agent details*, *Agent names in list*, *Agent labels on timeline*.
- **Timeline**: the axis mode and how much history to show.
- **Legend** explains every mark.

Check boxes keep the dropdown open so you can set several; Esc or a click elsewhere closes it. The same toggles are in the ribbon's **View** menu, and **Repositories → Sort by** orders the repositories.

## Keyboard

| Key | Action |
| --- | --- |
| Tab to the dashboard, then ↓ | Focus the first row |
| ↑ / ↓, Home / End | Move between branch and agent rows across repositories |
| → / ← | Expand / collapse the focused agent |
| Enter or Space | Select the row (opens it in the details panel) |
| Esc | Close dialogs, menus and suggestion lists |
| Ctrl+K | Search commands |
| Ctrl+B / Ctrl+Alt+B | Show or hide the repositories / details panel |
| F6 / Shift+F6 | Move focus to the next / previous group of tabs |
| + / − / 0 (dashboard focused) | Zoom the history in / out / reset |
| ↓ on a ribbon menu, then ↑ / ↓ | Open the menu and move through it |

## Removing a repository

In the repositories panel, **×** → **Remove from dashboard**. This only removes the entry from repobs; no files, branches or worktrees are touched and your session notes are kept.
