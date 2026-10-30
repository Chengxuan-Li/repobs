# Integrations

repobs observes provider data **read-only** and never changes provider configuration, installs hooks or sends transcript content anywhere. Formats are implementation details of each tool and may change; the adapters are versioned, tolerate unknown records, and degrade to *Unknown* with a sanitized diagnostic instead of failing.

## Claude Code

Observed with Claude Code 2.1.x on Windows (October 2026).

| What | Where (default) | Used for |
| --- | --- | --- |
| Session transcripts | `<home>\projects\<encoded-cwd>\<session-id>.jsonl` | session id, working directory (`cwd`, `relocated`), timestamps, version, recorded branch, title (`custom-title`), turn lifecycle |
| Subagent transcripts | `<home>\projects\<encoded-cwd>\<session-id>\subagents\agent-*.jsonl` | recent subagent activity (tail only, recently modified files only) |
| Live-session registry | `<home>\sessions\<pid>.json` | provider-reported `busy` / `idle`, session name, liveness of the recorded process |

`<home>` is the **Settings → Session sources** override, else `CLAUDE_CONFIG_DIR`, else `%USERPROFILE%\.claude`. The encoded project directory name is never decoded into a path; the working directory comes from the records. Files next to the registry such as `*.key` are never opened. Subagent transcripts are not listed as separate sessions.

Lifecycle mapping (structural fields only): an assistant record with `stop_reason: tool_use` → tool pending; `end_turn` (or a `stop_hook_summary` system record) → turn completed; a user prompt or tool result → turn in progress; Claude Code's fixed interrupt marker → turn interrupted. Message text is never stored; the interrupt marker is compared in memory and discarded.

**Hooks (not installed).** Claude Code hooks such as `PermissionRequest`, `Stop`, `SubagentStart`, `SessionStart` and `SessionEnd` could report precise state. A future, explicitly opt-in bridge could add a report-only hook with a clear uninstall; it would never approve or deny anything. v1 does not install or require hooks.

## OpenAI Codex

Observed with Codex 0.165 (desktop/VS Code originator) on Windows (October 2026).

| What | Where (default) | Used for |
| --- | --- | --- |
| Rollouts | `<home>\sessions\YYYY\MM\DD\rollout-*.jsonl` | thread id, cwd (`session_meta`, `turn_context`), timestamps, CLI version, parent thread (subagents), turn lifecycle |
| Archived rollouts | `<home>\archived_sessions\**\rollout-*.jsonl` | the same, for archived threads |
| Thread index | `<home>\session_index.jsonl` | thread names (titles) |

`<home>` is the Settings override, else `CODEX_HOME`, else `%USERPROFILE%\.codex`. One thread can span several rollout files (resumed sessions); repobs groups them by thread id and takes the state from the newest file. Threads with a parent thread id are counted as subagents of the parent.

Lifecycle mapping: `event_msg` `task_started` → turn in progress; `task_complete` → completed; `turn_aborted` → interrupted; `*_approval_request` → approval requested; `request_user_input` → input requested; `error` → error. The approval and input request names follow the Codex protocol but were **not observed** in local logs during development; they are covered by synthetic fixtures only.

**App server.** A Codex app-server reports `thread/status/changed` and approval flags only for threads that *that server* owns. repobs does not start one, and passive rollout reading cannot observe every approval wait of an independently running Codex process; such sessions show *Running* or *Unknown*, never a guessed *Awaiting approval*.

## Reading strategy

Transcripts can be tens of megabytes. On first sight repobs reads a bounded head (256 KB, for metadata) and tail (512 KB, for the latest state); afterwards only appended bytes. Partial last lines wait for completion; lines are split on newline bytes so multi-byte UTF-8 characters are never cut; truncated or replaced files are re-read from scratch; over-long lines (> 4 MB) are skipped. Directories are watched (`fs.watch`) and re-listed on a timer, so missed events are recovered.

## GitHub pull requests (optional)

Off by default. When enabled in **Settings → GitHub pull requests**, repobs runs the GitHub CLI read-only:

```text
gh pr list --repo <owner>/<repo> --state open --limit 100 --json number,title,url,headRefName,baseRefName,state,isDraft,updatedAt,headRepositoryOwner
```

for each registered repository whose `origin` (or first) remote is on github.com, every *N* minutes (default 10). It uses your existing `gh` login; repobs never logs in for you and stores no token. PRs are shown as **remote metadata** (`PR #42 → main`, with the time they were fetched) on matching branches; fork PRs are not matched to local branches. Offline, unauthenticated or missing `gh` is reported as such, and core features keep working. Disabling the integration removes the cached PR data from the view.

## Other harnesses and VS Code

Other agents can be added as new adapters behind the same interface (`apps/server/src/sessions/types.ts`). A VS Code extension would be a thin client of the same local API; nothing in repobs depends on VS Code.
