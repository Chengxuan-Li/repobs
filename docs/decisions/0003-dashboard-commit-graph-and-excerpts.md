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

- The Git allowlist gains exactly one read-only command: `git log` with a fixed NUL-separated format, `--topo-order`, a bounded `--max-count`, `--branches`, `--remotes` and explicit commit ids for detached heads. It is tested like the other commands and never writes.
- Commit subjects become visible in the UI (tooltips). They are local repository data, shown only to the paired browser.
- Session ids for Claude subagents take the form `claude:<session-id>__agent-<agent-id>`; their annotations are independent of the parent's.
- The keyboard model moves from a tree to a list of focusable rows with arrow-key navigation.
