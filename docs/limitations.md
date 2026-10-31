# Limitations

- **Windows first.** Developed and verified on Windows 11 with Git for Windows; macOS and Linux are expected to work and the test suite runs on Ubuntu in CI, but they are not the primary target. WSL paths, network shares (UNC paths) and SSH/remote machines are out of scope.
- **Local machine only.** No cross-machine view, shared team state or hosted instance. The public documentation site is documentation only.
- **Observation, not control.** repobs does not prompt, start, stop or approve agents, run shell commands, open terminals or modify Git (no fetch, pull, push, checkout, branch/worktree changes, stash, commit or conflict resolution).
- **Passive status limits.** States come from provider files and, for Claude Code, its live-session registry. Approval waits are shown only when a provider records them; pending tool calls are reported as ambiguous; stale inferred evidence becomes *Unknown*. Codex approval/input request events are supported from the protocol names but were not observed in local logs during development.
- **Provider formats can change.** Adapters were verified against Claude Code 2.1.x and Codex 0.165 files in October 2026. Unknown records produce partial metadata and *Unknown* state, never a crash.
- **No full transcripts or summaries.** Cards show only a truncated latest-message excerpt (optional); search covers titles, aliases, tags, ids and that excerpt — not conversation history.
- **Bounded commit graph.** The dashboard draws the 400 most recent commits reachable from local branches, remote-tracking refs and detached heads. Older history is not shown; commits reachable only through merges of deleted branches are drawn on the merging branch's row. *Pushed* means reachable from a remote-tracking ref within that window.
- **Excerpt redaction is best effort.** It catches common secret formats, not every possible secret; turn excerpts off if your agents handle sensitive material.
- **Remote refs may be stale.** They reflect your last fetch; repobs never fetches.
- **Session association** uses the session's working directory. A session whose directory no longer exists, or that matches no current worktree, is listed as *unassigned* rather than guessed; the branch a provider recorded during a session is historical and not used for association.
- **Sessions outside registered repositories** are counted in Diagnostics but not listed.
- **Watchers.** On Windows, repobs watches each worktree recursively (one OS handle per worktree) plus the Git directories and provider folders; polling recovers missed events. Turn off *Watch working files* in Settings for very large worktrees.
- **Docking.** Panels and views dock within the browser window; floating and pop-out windows are not available. On narrow windows (below about 1,100 px) the side panels stay docked rather than turning into overlays, so the dashboard gets narrow.
- **Views are per browser.** Views, their settings and the arrangement are stored in the browser (localStorage), not on the server; use File → Export / Open to move them to another browser.
- **Pull requests** require the GitHub CLI and are limited to open PRs (100 per repository) on github.com remotes.
- **Packaging.** Releases are a ready-to-run zip that needs Node.js 24; there is no standalone executable or installer, and the zip is not code-signed.
