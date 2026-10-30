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
repo-a  C:\src\repo-a                                    3 need attention · 8 agents
            Oct 25        Oct 27        Oct 29
main            ●───────────────────────────────◇        branch row: commits on a timeline
  Codex  Add rename detection test   Needs input  ▮      agent cards under their branch
  Claude Tighten status parser       Needs input  ▮
feature/tracked  ╰──○                                    forked from main; ○ = local only
  Claude Claude session c3d2e4f6     Working     ▬
    ↳ Explore Map the feature module Needs input  ▮      spawned agent, linked to its parent
```

- **One row per branch.** Local branches come first (the primary checkout's branch at the top, then other checked-out branches, then the rest by newest commit), then detached worktrees, *Unassigned sessions*, and — if *Remote-only branches* is ticked — remote refs without a local branch. The *Branches* menu shows all, only checked-out ones, or only branches with agents.
- **Commits are nodes, parent links are edges**, placed by commit time. A commit sits on the row of the first branch that reaches it along first parents, so a fork appears as a curve from the parent branch's row and a merge as a curve back into it. The branch name is drawn at its head.
- **Node styles:** filled = on a remote-tracking ref (pushed); hollow amber with dashed edges = only local, not pushed; grey dashed = on the upstream but not pulled yet; the dashed **diamond** after a head = uncommitted or untracked changes in that branch's worktree (red when there are conflicts). Hover a node for the commit id, subject and date.
- The label column shows the worktree(s), operations in progress (merge, rebase, …), `↑ahead ↓behind` against the **configured** upstream, `upstream gone`, `local only` or `remote only`. Remote refs reflect your last fetch — repobs never fetches. Only the most recent 400 commits per repository are drawn.
- **Timeline** sets the visible period (24 hours to all). The dotted vertical line is *now*.

## Agent cards

Each Claude Code or Codex session is a card under the branch whose worktree it ran in, newest first, with a bar on the timeline from its first to its last activity. A card shows:

- provider, title (provider title, your alias, or a fallback such as *Claude session 1a2b3c4d*) and the age of its last activity;
- **workflow status** — *Needs input*, *Working*, *Needs review*, *Ready*, *Complete* or *Unknown* — plus the observed execution state with its confidence (see [Status semantics](status-semantics.md));
- the **latest message excerpt**: the agent's last reply, or the tool it is running with the tool's own description (for example *Bash: Run the unit tests*). It is read mechanically from the provider's file, truncated, with obvious secrets redacted, and never stored; Settings → Privacy turns it off;
- spawned agents (Claude Code subagents, Codex sub-threads) as indented cards linked to their parent; **Hide spawned agents** removes them;
- a **review dropdown** to set your review state without opening anything;
- with **Show notes & tags**: your alias, tags, full notes (line breaks preserved) and checklist progress.

Long lists show the 12 newest agents per branch and a *Show N more agents* row.

## Your notes

Select a card (click its title, or use the keyboard) to open it in the details panel:

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
| Enter or Space | Select the row (opens it in the details panel) |
| Tab inside a card | Reach its review dropdown |
| Esc | Close dialogs and suggestion lists |
| ← / → on a panel divider | Resize the panel |

## Removing a repository

In the repositories panel, **×** → **Remove from dashboard**. This only removes the entry from repobs; no files, branches or worktrees are touched and your session notes are kept.
