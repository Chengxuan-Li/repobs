---
hide:
  - navigation
  - toc
---

<div class="ui-hero" markdown>

# Observe worktrees and agents<br>*locally, on one timeline.*

repobs is a local, read-only dashboard: each repository's branches on one timeline, with the Claude Code and Codex agents that worked on them, what they are doing now, and what you still need to review.

[Get started](getting-started.md){ .md-button .md-button--primary } [Download](https://github.com/Chengxuan-Li/repobs/releases/latest){ .md-button }

</div>

## Documentation { .ui-strip data-index="01" data-note="Two parts" }

<div class="grid cards" markdown>

-   [User guide](guide/index.md)

    For people who use repobs: installing it, the dashboard and its agent cards, review states, notes and checklists, automation, what each status means, what is read from Claude Code and Codex, and what stays private.

    [Open the user guide](guide/index.md){ .md-button }

-   [Developer](developer/index.md)

    For people who change repobs itself: the architecture, the HTTP API, testing, the progress log and the architecture decision records.

    [Open the developer documentation](developer/index.md){ .md-button }

</div>

## What repobs shows { .ui-strip data-index="02" data-note="At a glance" }

- **Your repositories:** branches, worktrees and commits on one timeline, with forks, merges, unpushed commits and uncommitted changes.
- **Your agents:** Claude Code and Codex sessions on the branches they worked on, with their status and the evidence behind it, and the plan an agent keeps with its planning tool.
- **Your review:** review states, tags, notes, checklists and automation rules, kept by repobs and never written to your repositories.

<video class="ui-film" controls preload="none" playsinline width="1920" height="1080" poster="assets/repobs-film-poster.jpg" aria-label="The repobs film, 25 seconds, with sound">
  <source src="assets/repobs-film.mp4" type="video/mp4">
  <a href="assets/repobs-film.mp4">Download the repobs film (MP4, 25 seconds)</a>
</video>

*A 25-second film, animated: the repositories, branches and agents in it are invented. Below, the real application.*

![repobs dashboard with synthetic demo data](assets/repobs-overview.png)

*The real application on synthetic demo data (`npm run demo`): no real repositories or sessions.*

## Local and read-only { .ui-strip data-index="03" data-note="By design" }

repobs runs on your machine and listens on `127.0.0.1` only. It never runs `git fetch`, checkout, commit or any other command that changes a repository, never edits agent files or configuration, never installs hooks and never calls a model API. From session files it reads structural metadata and, unless you turn them off, a short redacted excerpt of each agent's latest message and the agent's plan steps; these stay in memory and are never saved. Your annotations live under `%LOCALAPPDATA%\repobs`. Nothing is sent anywhere unless you turn on the optional GitHub pull request lookup. See [Privacy & security](privacy-security.md).

## Support { .ui-strip data-index="04" data-note="Platforms and agents" }

| | Status |
| --- | --- |
| Windows 11, Git for Windows | Primary platform, tested |
| macOS / Linux | Expected to work (CI runs the suite on Ubuntu); not the primary target |
| Claude Code, terminal and desktop app (2.1.x session files) | Supported, verified against local data |
| OpenAI Codex CLI and desktop (0.165 rollout files) | Supported, verified against local data |
| Node.js | 24 LTS (24.11 or newer) |
| GitHub pull requests | Optional, read-only, off by default (GitHub CLI) |
