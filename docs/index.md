---
hide:
  - navigation
  - toc
---

<div class="ui-hero" markdown>

# Observe your Git worktrees and coding agents, locally.

repobs is a local-first, read-only dashboard for developers who juggle many Git worktrees, temporary agent branches and Claude Code / Codex sessions across projects.

[Get started](getting-started.md){ .md-button .md-button--primary } [Download a release](https://github.com/Chengxuan-Li/repobs/releases){ .md-button }

</div>

## Documentation { .ui-strip data-index="01" data-note="Guide and reference" }

<div class="grid cards" markdown>

-   [Getting started](getting-started.md)

    Install from a release or from source, start repobs and add your first repositories.

-   [User guide](user-guide.md)

    Views, the commit graph and agent cards, filters, panels, notes and shortcuts.

-   [Status semantics](status-semantics.md)

    What each agent state means, and the evidence and confidence behind it.

-   [Integrations](integrations.md)

    How Claude Code, Codex and the optional GitHub lookup are read.

-   [Privacy & security](privacy-security.md)

    What repobs reads, stores and never sends anywhere.

-   [Limitations](limitations.md)

    What is not supported yet, and known gaps.

-   [Architecture](architecture.md)

    The server, adapters, persistence and web UI, and how they fit together.

-   [HTTP API](api.md)

    Every endpoint and schema of the loopback API, generated from the contracts.

</div>

## At a glance { .ui-strip data-index="02" data-note="What repobs answers" }

At a glance, repobs shows:

- which repositories are registered, and which local, remote-tracking and remote-only refs exist;
- how branches relate on a **commit graph over time** — forks, merges, what is only local and not pushed, which heads have uncommitted work — and which worktree each branch is checked out in (staged, unstaged, untracked, conflicts, merge/rebase/cherry-pick in progress, ahead/behind, errors);
- which Claude Code and Codex agents worked on each branch — as cards with their status, the evidence behind it, a short excerpt of their latest message, and the agents they spawned — including sessions started outside repobs and several per worktree;
- what **you** still need to review, with your own tags, review states, notes and checklists.

The view updates by itself when Git or agent data changes on disk.

![repobs dashboard with synthetic demo data](assets/repobs-overview.png)

*Screenshot of the real application running on the synthetic demo data from `npm run demo` (no real repositories or sessions).*

## What repobs is not { .ui-strip data-index="03" data-note="Read-only by design" }

repobs is **not** an agent launcher, an IDE, a terminal or a Git client. It never runs `git fetch`, checkout, commit, reset or any other mutating command, never edits agent histories or configuration, never installs hooks, and never calls a model API. Removing a repository from repobs deletes nothing on disk.

## Privacy in one paragraph { .ui-strip data-index="04" data-note="Local only" }

repobs runs on your machine and binds to `127.0.0.1` only. Your annotations live in an app database under `%LOCALAPPDATA%\repobs`, never in a repository or transcript. It reads only structural metadata from provider session files (ids, timestamps, working directory, turn lifecycle) — not prompts, code or tool output — and sends nothing anywhere unless you explicitly enable the optional GitHub pull-request lookup. See [Privacy & security](privacy-security.md).

## Support matrix { .ui-strip data-index="05" data-note="Platforms and harnesses" }

| | Status |
| --- | --- |
| Windows 11, native paths, Git for Windows | Primary platform, tested |
| macOS / Linux | Expected to work (CI runs the suite on Ubuntu); not the primary target |
| Claude Code (2.1.x session files) | Supported, verified against local data |
| OpenAI Codex CLI / desktop (0.165 rollout files) | Supported, verified against local data |
| Node.js | 24 LTS (24.11 or newer) |
| GitHub pull requests | Optional, read-only, off by default (GitHub CLI) |

Continue with [Getting started](getting-started.md).
