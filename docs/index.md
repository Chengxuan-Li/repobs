# repobs

**Observe your Git worktrees and coding agents, locally.**

repobs is a local-first, read-only dashboard for developers who juggle many Git worktrees, temporary agent branches and Claude Code / Codex sessions across projects. It answers, at a glance:

- which repositories are registered, and which local, remote-tracking and remote-only refs exist;
- how branches relate on a **commit graph over time** — forks, merges, what is only local and not pushed, which heads have uncommitted work — and which worktree each branch is checked out in (staged, unstaged, untracked, conflicts, merge/rebase/cherry-pick in progress, ahead/behind, errors);
- which Claude Code and Codex agents worked on each branch — as cards with their status, the evidence behind it, a short excerpt of their latest message, and the agents they spawned — including sessions started outside repobs and several per worktree;
- what **you** still need to review, with your own tags, review states, notes and checklists.

The view updates by itself when Git or agent data changes on disk.

![repobs dashboard with synthetic demo data](assets/repobs-overview.png)

*Screenshot of the real application running on the synthetic demo data from `npm run demo` (no real repositories or sessions).*

## What repobs is not

repobs is **not** an agent launcher, an IDE, a terminal or a Git client. It never runs `git fetch`, checkout, commit, reset or any other mutating command, never edits agent histories or configuration, never installs hooks, and never calls a model API. Removing a repository from repobs deletes nothing on disk.

## Privacy in one paragraph

repobs runs on your machine and binds to `127.0.0.1` only. Your annotations live in an app database under `%LOCALAPPDATA%\repobs`, never in a repository or transcript. It reads only structural metadata from provider session files (ids, timestamps, working directory, turn lifecycle) — not prompts, code or tool output — and sends nothing anywhere unless you explicitly enable the optional GitHub pull-request lookup. See [Privacy & security](privacy-security.md).

## Support matrix

| | Status |
| --- | --- |
| Windows 11, native paths, Git for Windows | Primary platform, tested |
| macOS / Linux | Expected to work (CI runs the suite on Ubuntu); not the primary target |
| Claude Code (2.1.x session files) | Supported, verified against local data |
| OpenAI Codex CLI / desktop (0.165 rollout files) | Supported, verified against local data |
| Node.js | 24 LTS (24.11 or newer) |
| GitHub pull requests | Optional, read-only, off by default (GitHub CLI) |

Continue with [Getting started](getting-started.md).
