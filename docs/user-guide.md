# User guide

## The workbench

- **Ribbon** (top): Add repository, quick filter, *All / Attention* switch, *Historical* toggle, Diagnostics, theme (system → light → dark), Settings, inspector toggle.
- **Repository tree** (left, resizable): the main navigation.
- **Center**: the overview (attention queue and worktree roll-up) or details of the selected repository, branch, worktree or session.
- **Inspector** (right, resizable, can be hidden): your notes for a selected session; identifiers for other nodes.
- **Status bar** (bottom): counts, last sync time, live connection state, and a *Monitoring degraded* link when something needs attention.

Pane widths, expansion, selection, filters and the theme are remembered.

## Reading the tree

```text
repo-a                              repository
  main  ↑1                          local branch checked out (ahead of its upstream)
    repo-a  +1 ~1 ?1                primary worktree: 1 staged, 1 unstaged, 1 untracked
      Claude  Parser fix  ●  3m     a session in this worktree
      Codex   Review tree ! 7m
  feature/tracked
    feature  clean                  linked worktree
  Detached HEAD (2)                 worktrees with a detached HEAD (e.g. during a rebase)
  Branches without worktree (4)     local branches that are not checked out
  Remote-only (1)                   remote-tracking refs with no local branch
  Unassigned sessions (1)           sessions related to this repository that match no current worktree
Unassigned sessions (no repository) annotated sessions whose repository is gone
```

- **Local vs remote:** a local branch and its remote-tracking ref are one node; the upstream is shown as `↑ahead ↓behind` against the **configured upstream** (never an assumed `origin/main`). `gone` means the configured upstream ref no longer exists locally. Remote refs reflect your last fetch — repobs never fetches.
- **Worktree badges:** `merge`, `rebase`, `cherry-pick`, `revert`, `bisect` in progress; `N conflicts`; `locked`; `prunable` / `missing` when Git lists a worktree whose directory is gone.
- **Agent branch names** such as `claude/...` or `codex/...` are shown exactly as Git reports them.
- **Sessions:** provider, title (provider title or a fallback such as *Claude session 1a2b3c4d*, or your alias), observed state, age of the last activity, and your review badge. Historical sessions are dimmed; hide them with the *Historical* toggle.

Hover a row for its full path or ref. Every color also has text (for screen readers, each row's name spells out kind, state and review state).

## Keyboard

| Key | Action |
| --- | --- |
| ↑ / ↓ | Move between rows |
| → | Expand, or move to the first child |
| ← | Collapse, or move to the parent |
| Home / End | First / last row |
| Enter or Space | Select (opens details) |
| Shift+F10 or Menu key | Context menu (copy path/id, review state, remove repository) |
| Esc | Close menus and dialogs |
| ← / → on a pane divider | Resize the pane |

## Sessions and their state

Selecting a session shows its **observed execution state** with the *evidence* behind it: direct (reported by the provider), inferred (from local session records) or unknown, the reason, the source, and the time of the evidence. Read [Status semantics](status-semantics.md) for what each state does and does not mean. The branch a provider recorded during the session is shown as historical information; it does not prove what is checked out today.

## Your review: tags, review state, notes, checklists

With a session selected, the inspector holds **your** metadata, independent of the agent's state:

- **Review state:** Unreviewed, Needs review, Reviewed, Complete, Flagged.
- **Display alias** and free **tags** (searchable from the quick filter).
- **Scratch note:** plain text, saved automatically (the inspector shows *Saving…*, *Saved* or an error with *Retry*).
- **Checklist:** add items, tick them, reorder with the arrow buttons, delete an item with its bin button. When every item is done, the checklist collapses to *All N checklist items complete* — **Show completed** brings it back. Nothing is deleted unless you delete it.

Two sessions in the same worktree have completely separate notes. Notes survive restarts, refreshes, removal of the repository from the dashboard, deletion of the worktree and disappearance of the provider's session file (the session then appears under *Unassigned sessions* with *source missing*). **Clear annotations…** deletes a session's notes after confirmation. Settings → Annotations exports or imports all notes as JSON (never transcripts).

## Filters

- **Attention** keeps what needs a human: sessions with a recorded approval or input request, errors, or a pending tool call that may be waiting for permission; sessions you marked *Needs review* or *Flagged*; worktrees with conflicts, an operation in progress, a status error or a missing directory.
- **Quick filter** matches repository names and paths, refs, worktree paths, session titles, aliases, ids and your tags. It never searches conversation content (repobs does not read it).

## Removing a repository

Context menu → **Remove from dashboard…**. This only removes the entry from repobs; no files, branches or worktrees are touched and your session notes are kept.
