---
template: home.html
hide:
  - navigation
  - toc
  - footer
---

<div class="ui-product" markdown>

<div class="ui-hero-stage" markdown>

<div class="ui-hero" markdown>

# repobs

*every worktree and coding agent,<br>on one local timeline.*
{ .ui-tagline }

A read-only dashboard for developers who run many coding agents across Git worktrees and branches: each repository's branches on one timeline, with the Claude Code and Codex agents that worked on them, what they are doing now, and what you still need to review.

[Download](https://github.com/Chengxuan-Li/repobs/releases/latest){ .md-button .md-button--primary } [Get started](tutorial/start.md){ .md-button }

</div>

</div>

<div id="features" class="ui-features" markdown>

### See every branch { .ui-feature-title }

<div class="ui-feature" markdown>

![The timeline: branches, commits and the agents that worked on them](assets/feature-timeline.png#only-light){ .ui-feature__media }
![The timeline: branches, commits and the agents that worked on them](assets/feature-timeline-dark.png#only-dark){ .ui-feature__media }

<div class="ui-feature__text" markdown>

<span class="ui-icon" data-icon="timeline"></span>

*Your repositories, branches and worktrees on one timeline.*
{ .ui-feature__lead }

- Forks, merges, unpushed commits and uncommitted changes.
- Scratch branches, detached HEADs and missing worktrees.
- Commit order or calendar time; zoom, pan and fold quiet history.

</div>

</div>

### Follow every agent { .ui-feature-title }

<div class="ui-feature" markdown>

![An agent's details: its status, the evidence and the plan it keeps](assets/feature-agent.png#only-light){ .ui-feature__media }
![An agent's details: its status, the evidence and the plan it keeps](assets/feature-agent-dark.png#only-dark){ .ui-feature__media }

<div class="ui-feature__text" markdown>

<span class="ui-icon" data-icon="agents"></span>

*Each Claude Code and Codex agent, on the branch it worked on.*
{ .ui-feature__lead }

- Its status with the evidence behind it, and *Unknown* when there is none.
- The sub-agents it spawned and its latest message.
- The plan it keeps with its planning tool, step by step.

</div>

</div>

### Review on your terms { .ui-feature-title }

<div class="ui-feature" markdown>

![An agent's checklist: the agent's plan first, then your own items](assets/feature-review.png#only-light){ .ui-feature__media }
![An agent's checklist: the agent's plan first, then your own items](assets/feature-review-dark.png#only-dark){ .ui-feature__media }

<div class="ui-feature__text" markdown>

<span class="ui-icon" data-icon="review"></span>

*Your notes on the agents, kept apart from their work.*
{ .ui-feature__lead }

- Review states, tags, aliases and notes.
- Checklists: the agent's plan first, then your own items.
- Automation rules, for example *idle for 7 days → Outdated*.

</div>

</div>

### Local and read-only { #local-and-read-only .ui-feature-title }

<div class="ui-feature ui-feature--plain" markdown>

<span class="ui-icon" data-icon="local"></span>

<div class="ui-feature__text" markdown>

*Nothing leaves your machine, and nothing is written to your repositories.*
{ .ui-feature__lead }

- repobs listens on `127.0.0.1` only, has no telemetry and calls no model API.
- Git is used only through read-only commands; agent files and configuration are never edited.
- Message excerpts and plan steps stay in memory; your notes live under `%LOCALAPPDATA%\repobs`.

See [Privacy & security](privacy-security.md).

</div>

</div>

</div>

<div id="documentation" class="ui-cards">
  <a class="ui-card" href="guide/">
    <span class="ui-icon" data-icon="guide"></span>
    <span class="ui-card__title">User guide <span class="ui-card__mark" aria-hidden="true">→</span></span>
    <span class="ui-card__text">For people who use repobs: installing it, the dashboard and its agent cards, review states, notes and checklists, automation, what each status means, and what stays private.</span>
    <span class="ui-card__wash" aria-hidden="true"><span class="ui-icon-backdrop" data-icon="guide"></span></span>
  </a>
  <a class="ui-card" href="developer/">
    <span class="ui-icon" data-icon="developer"></span>
    <span class="ui-card__title">Developer <span class="ui-card__mark" aria-hidden="true">→</span></span>
    <span class="ui-card__text">For people who change repobs itself: the architecture, the HTTP API, testing, the progress log and the architecture decision records.</span>
    <span class="ui-card__wash" aria-hidden="true"><span class="ui-icon-backdrop" data-icon="developer"></span></span>
  </a>
</div>

<div class="ui-closing" markdown>

*See your agents on one timeline.*
{ .ui-tagline }

[Download](https://github.com/Chengxuan-Li/repobs/releases/latest){ .md-button .md-button--primary } [Get started](tutorial/start.md){ .md-button }

</div>

</div>
