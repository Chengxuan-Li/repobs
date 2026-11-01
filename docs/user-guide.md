# User guide

## The workbench

- **Ribbon** (top): the **File** and **View** menus; **Search commands** (Ctrl+K), which finds and runs any command by typing part of its name (including the current view's display options, renaming it, zoom and repository sorting); and icon buttons for the repositories and details panels and the theme (system → light → dark).
  - **File**: **Export…**, **Open…**, **Settings**, **Diagnostics**.
  - **View**: **Panels** (repositories panel, details panel, Maximize view, Reset layout), **Open new view**, **Styling** (match the system, light, dark), **Full screen**, **Refresh** (read every repository and agent session again now; normally changes arrive by themselves).
- **Views** (centre tabs): each view is a dashboard — one section per repository with its branches, commits and agents on a shared timeline — with its own filters, display options and repositories. See [Views](#views).
- **Repositories panel** (left side bar by default): every repository registered in repobs, with agent counts and last activity, sorted by the **Sort** dropdown (the ⇅ button beside **Add**). The ticks are the current view's selection (*Ticked repositories are shown in View 0*); click a name to jump to it in the current view, **×** to remove it from repobs (no files are touched).
- **Details panel** (right side bar by default): evidence and your notes for the selected agent, or upstream/worktree/status details for the selected branch. Selecting an agent or branch opens it if it is hidden.
- **Status bar** (bottom): counts, last sync time, live connection state, and a *Monitoring degraded* link when something needs attention.

### Arranging the panels

The panels dock like an IDE's:

- Click a panel's name in a side bar to collapse or expand it; drag the edge between panels to resize.
- **Drag** a panel's or a view's tab beside another view, into the other side bar, or onto a tab strip; the drop target is outlined while you drag. An empty side bar still accepts panels.
- Side panels keep a minimum width (repositories 280 px, details 320 px) so their one-line entries do not wrap.
- Close a docked panel with its **×**; bring it back from **View → Panels**, the ribbon buttons, or Ctrl+B / Ctrl+Alt+B.
- **View → Panels → Maximize view** collapses the open panels to give the current view the whole window; choose it again to bring them back.
- **View → Panels → Reset layout** puts every view back into one tab strip and the panels back in their side bars; views keep their names and settings.

Only the panels scroll; the page itself never does. The arrangement, the views with their settings, the selection and the theme are remembered in this browser.

## Views

A view is a dashboard tab with its own settings: filters, display options, axis and zoom, collapsed and expanded rows, and which repositories it shows. Use views for different angles on the same project — say, one on the main repository with every agent, one on a scratch repository showing only agents that need input.

- **View → Open new view** (Ctrl+Alt+N) adds one beside the current view, with default settings. It is named *View n* with the smallest number no other view uses, counting from 0: rename *View 0* and *View 1* to *View main* and *View 1*, and the next new view is *View 0*.
- **Rename** a view by double-clicking its tab, or with *Rename view* from Search commands. Names cannot be empty or repeat another view's name.
- **Close** a view with the **×** on its tab; its settings are dropped. The last view cannot be closed.
- **Which repositories a view shows**: tick or untick them in the repositories panel (the ticks follow the current view) or use the view's **Repositories** dropdown. A newly registered repository appears in every view.
- The **current view** is the one you last selected, clicked or focused; the repositories panel, the details panel and the view commands in Search commands act on it. The selection (which agent or branch the details panel shows) is shared by all views.

**File → Export…** saves one JSON file with your annotations (aliases, review states, tags, notes and checklists, as in Settings → Annotations; no transcript content) and every view with its name, settings and the arrangement. **File → Open…** reads such a file: annotations are merged (older or already present ones are skipped) and its views replace the current ones. It also accepts an annotation export from Settings.

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
- **Pan** like a map: press the mouse button on the history (or the label column) and drag; the view follows the pointer in both directions. A press that barely moves is still a click, so selecting rows and expanding groups work as before. Controls (status menus, chevrons, buttons) do not start a pan.
- **Zoom** stretches or compresses the axis horizontally: the **−** / **+** buttons at the left of the axis, **Ctrl + mouse wheel** over the dashboard (zooms around the pointer), or **+**, **−** and **0** (reset) while the dashboard has focus. The percentage button resets to 100%. Zooming out below 100% only packs commits closer when history is wider than the window.

## Agents

Each Claude Code or Codex session is a **one-line card** under the branch whose worktree it ran in, newest first: a chevron with a count if it spawned other agents, a provider mark (**C** = Claude Code, **X** = Codex), the name (your alias if you set one, else the provider title or a fallback such as *Claude session 1a2b3c4d*) and its **workflow status** — *Needs input*, *Working*, *Flagged*, *Needs review*, *Unreviewed*, *Reviewed*, *Complete*, *Outdated* or *Unknown* (see [Status semantics](status-semantics.md)). Its bar on the lanes runs from its first to its last activity, coloured by that status.

**Click the status** to set your review state from a menu (Unreviewed, Needs review, Reviewed, Complete, Flagged, Outdated; each with a dot in its colour, hollow for Outdated); the same menu is in the agent's hover card. A finished agent you have not reviewed shows *Unreviewed*, never a success colour. The menu's last item, **Hide from this view**, hides the agent from the current view (see *Hidden* under [Filters and view options](#filters-and-view-options)).

When an agent has a checklist — its own plan, your items, or both — a rounded pill follows its status, on the card and on the timeline label. It shows a small pie that fills clockwise with the share of items done, then the **done/total** count (for example *1/3*). The pill is blue while items are open, green when all are done and grey before any is. Hover or click it to open its list, where you tick or untick items. The list has two parts: first the **agent's plan**, the steps the agent keeps with its planning tool (Claude's task list or to-do list, Codex's plan), synced as it works and marked *in progress* where it says so; then **your items**. The agent never changes your items. You can tick or untick the agent's steps by your own judgement (*ticked by you*); that stays in repobs and never reaches the agent, and choosing the agent's own status again clears it. Opened by hover, the list closes shortly after the pointer leaves the pill and the list. Opened by a click, it stays until Escape or a click elsewhere.

Cards never grow on the dashboard; the details are a hover or a click away:

- **Hover** the row, its bar or its card on the timeline for the observed state and why, last activity, the **latest message excerpt** (the agent's last reply, or the tool it is running with the tool's own description), review state, tags, notes (line breaks kept) and checklist progress. The card opens beside the label column (below the card on the timeline); move onto it to use its review menu. Hover cards open next to the item you point at and stay put while the pointer moves inside it (on a long bar, where the pointer entered); they move only to stay inside the window.
- **Select** it (click its name, or Enter) to open it in the details panel.

Excerpts are read mechanically from the provider's files, truncated, with obvious secrets redacted, and never stored; Settings → Privacy turns them off.

**Where agent names appear** — two independent toggles in the **Agents** dropdown:

- **Agent labels on timeline** (on by default): each agent's bar ends with a card like the one in the list: provider mark, name, how long ago it was last active and its status, which opens the same review menu. You read who worked when right in the history and can review there. Near the right edge the card moves to the left of the bar; click it to select the agent.
- **Agent names in list** (on by default): the names in the label column. Turn it off to give the history more room: the column narrows and each card keeps its provider mark, spawn-tree position and status menu.

Either, both or neither can be on; with both off, hover a card or bar to see who it is.

Spawned agents (Claude Code subagents, Codex sub-threads) start hidden under the agent that started them, whose card shows a chevron and how many it spawned (› 2). Click the chevron, or press → on the focused row (← hides them again), to show them: cards indented one step per spawn level, with tree lines in the gutter left of the cards that continue across rows, from the bottom of the parent's card to each child; on the lanes, a thin line links the parent's bar to its children's. Untick **Agents → Collapse spawned agents** to show every spawned agent (the chevrons then hide them one parent at a time); switching it resets the individual choices. Long lists show the 12 newest agents per branch and a *Show N more agents* row.

## Your notes

Select an agent (click its name, or use the keyboard) to open it in the details panel:

- **Review state** dropdown: Unreviewed, Needs review, Reviewed, Complete, Flagged, Outdated (no longer relevant).
- **Display alias**.
- **Tags** with autocomplete: start typing and existing tags are suggested (most used first); **Tab** or **Enter** takes the highlighted one, **↑/↓** move, **Backspace** in an empty field removes the last tag.
- **Notes**: plain text; Enter starts a new line, and line breaks are shown on the card.
- **Agent plan** (above your notes, when the agent keeps one): its steps, where they came from and when the agent last updated them; tick or untick a step to override it in repobs.
- **Checklist**: add, tick, untick, reorder, delete. Ticked items stay in the list, struck through, also when every item is done. Nothing is deleted unless you delete it.

When an [automation rule](#automation) changed the agent, a line under your notes names the rule and when it ran.

Everything saves automatically to the local repobs database. Notes belong to the agent session: they survive restarts, removal of the repository from the dashboard, deletion of the worktree and disappearance of the provider's file. **Clear annotations…** deletes a session's notes after confirmation; Settings → Annotations exports or imports them as JSON.

## Filters and view options

The bar above the dashboard has the filters on the left and the view options on the right; each dropdown shows its current value, and a filter that narrows the list shows its value in the accent colour.

**Filters** (which agents are shown):

- **Search**: titles, aliases, tags, session ids and the latest message excerpt.
- **Harness**: *Any harness*, or tick one or more of Claude Code and Codex. Ticking every harness is the same as *Any*.
- **Status**: *Any status*, or tick any combination of the workflow statuses.
- **Last message**: any time, or within 24 hours, 2, 3, 7, 14 or 40 days.
- **Tags**: type to pick tags (with the same autocomplete as the notes); agents with any of them are shown.
- **Hidden**: hide agents with chosen review states (*Hide agents marked*, for example *Outdated*; an agent without notes counts as *Unreviewed*), and see the agents you hid by hand with **Hide from this view**, each with **Show**, or **Show all**. Hiding changes this view only: the agents and your notes stay as they are.

The agent count follows the filters, and **Clear filters** resets them (including hidden agents). Filters apply to agents; branches stay visible according to the *Branches* dropdown.

**View options** (how the history is drawn):

- **Repositories**: all repositories, or tick the ones this view shows (the same as the ticks in the repositories panel).
- **Branches**: all branches, checked-out ones, or branches with agents; *Remote-only branches*; *Collapse quiet commits*.
- **Agents**: *Collapse spawned agents*, *Agent names in list*, *Agent labels on timeline*.
- **Timeline**: the axis mode and how much history to show.
- **Legend** explains every mark.

## Automation

**View → Panels → Automation panel** (Ctrl+Alt+U) opens rules that label agents for you: when a rule's conditions hold for an agent, its actions change that agent's notes, exactly as if you had edited them. Rules never hide anything; for that, use a view's *Hidden* filter.

- **Conditions** (all must hold, or any one): last activity more than or within N hours or days; a keyword in the title, alias, note, tags, repository name, branch, agent type or latest message; review state; a tag set or not; harness; working/waiting or finished; checklist all ticked, with open items, or empty; spawned by another agent or not.
- **Actions**: set the review state, add or remove a tag, set the alias, add to the note, add a checklist item (once), tick checklist items (all, or those containing a text), remove ticked items.
- **Before you save**, the editor shows how many agents the conditions match now; hover the count for up to ten names. Saving an enabled rule applies it to them at once, and to other agents as they come to match (age conditions are checked at every session rescan).
- **A rule can stop matching the agents it changed.** For example, "idle for 7 days and unreviewed → outdated" turns those agents *Outdated*, so they are no longer unreviewed: afterwards the rule matches 0 agents, while its *changed* count shows what it did. When you edit a saved rule, the editor shows that count beside the matches (*· already changed N*).
- **All or any.** With *any of these holds*, one condition is enough. "Idle for 7 days *or* unreviewed" also matches every recent agent you have not reviewed, so check the count before you save.
- **Once per version:** a rule changes each agent at most once per version of the rule. If you change that agent afterwards, your change stays. Editing a rule's conditions or actions makes a new version, which applies again; renaming it or switching it off and on does not.
- Each rule shows how many agents it matches now and how many its current version changed. **Delete** removes the rule but keeps the changes it made.
- With no rules yet, the panel offers starting points: mark agents idle for 7 days as outdated, complete agents whose checklist is done, ask for review of agents with "fix" in the title.

Rules live in the local repobs database and run only while repobs runs. See [ADR 0008](decisions/0008-automation-rules-and-view-hiding.md).

Check boxes keep the dropdown open so you can set several; Esc or a click elsewhere closes it. The same toggles are in Search commands (Ctrl+K) under *Current view*. These settings belong to the view: another view keeps its own.

## Keyboard

| Key | Action |
| --- | --- |
| Tab to the dashboard, then ↓ | Focus the first row |
| ↑ / ↓, Home / End | Move between branch and agent rows across repositories |
| → / ← | Show / hide the agents the focused agent spawned |
| Enter or Space | Select the row (opens it in the details panel) |
| Esc | Close dialogs, menus and suggestion lists |
| Ctrl+K | Search commands |
| Ctrl+B / Ctrl+Alt+B | Show or hide the repositories / details panel |
| Ctrl+Alt+N | Open a new view |
| Double-click a view's tab | Rename the view |
| Drag with the mouse on a view | Pan the history and rows |
| F6 / Shift+F6 | Move focus to the next / previous group of tabs |
| + / − / 0 (dashboard focused) | Zoom the history in / out / reset |
| ↓ on a ribbon menu, then ↑ / ↓ | Open the menu and move through it |

## Removing a repository

In the repositories panel, **×** → **Remove from repobs**. It disappears from every view. This only removes the entry from repobs; no files, branches or worktrees are touched and your session notes are kept.
