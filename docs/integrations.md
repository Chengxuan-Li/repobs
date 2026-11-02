# Integrations

repobs observes provider data **read-only** and never changes provider configuration, installs hooks or sends transcript content anywhere. Formats are implementation details of each tool and may change; the adapters are versioned, tolerate unknown records, and degrade to *Unknown* with a sanitized diagnostic instead of failing.

## Claude Code

Observed with Claude Code 2.1.x on Windows (October 2026).

| What | Where (default) | Used for |
| --- | --- | --- |
| Session transcripts | `<home>\projects\<encoded-cwd>\<session-id>.jsonl` | session id, working directory (`cwd`, `relocated`), timestamps, version, recorded branch, title (`custom-title`), turn lifecycle |
| Subagent transcripts | `<home>\projects\<encoded-cwd>\<session-id>\subagents\agent-*.jsonl` and `agent-*.meta.json` | spawned agents as child sessions: type and description (title), times, state, latest excerpt (small head/tail reads) |
| Live-session registry | `<home>\sessions\<pid>.json` | provider-reported `busy` / `idle`, session name, liveness of the recorded process |

`<home>` is the **Settings → Session sources** override, else `CLAUDE_CONFIG_DIR`, else `%USERPROFILE%\.claude`. The encoded project directory name is never decoded into a path; the working directory comes from the records. Files next to the registry such as `*.key` are never opened. Subagents appear as child sessions (`claude:<session-id>__agent-<agent-id>`) linked to their parent.

Lifecycle mapping (structural fields only): an assistant record with `stop_reason: tool_use` → tool pending; `end_turn` (or a `stop_hook_summary` system record) → turn completed; a user prompt or tool result → turn in progress; Claude Code's fixed interrupt marker → turn interrupted; an assistant record flagged `isApiErrorMessage` (a failed API call: not signed in, rate limit, server error) → error, until the next prompt. The flag is read; the error text is treated like any assistant text. The **latest message excerpt** is the last assistant text item, or the last `tool_use` as `<tool>: <input.description>`. User prompts are never taken. The interrupt marker is compared in memory and discarded.

**Hooks (not installed).** Claude Code hooks such as `PermissionRequest`, `Stop`, `SubagentStart`, `SessionStart` and `SessionEnd` could report precise state. A future, explicitly opt-in bridge could add a report-only hook with a clear uninstall; it would never approve or deny anything. v1 does not install or require hooks.

## OpenAI Codex

Observed with Codex 0.165 (desktop/VS Code originator) on Windows (October 2026), and with Codex 0.166 (desktop app 26.1027) in November 2026 for compressed rollouts and the state database ([ADR 0012](decisions/0012-codex-compressed-rollouts-and-state-database.md)).

| What | Where (default) | Used for |
| --- | --- | --- |
| Rollouts | `<home>\sessions\YYYY\MM\DD\rollout-*.jsonl` | thread id, cwd (`session_meta`, `turn_context`), timestamps, CLI version, parent thread (subagents), turn lifecycle |
| Compressed rollouts | `<home>\sessions\YYYY\MM\DD\rollout-*.jsonl.zst` | the same; Codex 0.166 compresses older rollouts in place with zstd |
| Archived rollouts | `<home>\archived_sessions\**\rollout-*.jsonl` (or `.jsonl.zst`) | the same, for archived threads |
| Thread index | `<home>\session_index.jsonl` | thread names (titles) |
| State database | `<home>\state_5.sqlite`, tables `threads` and `thread_spawn_edges` | thread names when the index has none; metadata-only sessions for threads without a readable rollout |

`<home>` is the Settings override, else `CODEX_HOME`, else `%USERPROFILE%\.codex`. One thread can span several rollout files (resumed sessions); repobs groups them by thread id and takes the state from the newest file. A forked sub-agent's rollout repeats its parent's `session_meta` after its own; the first one names the thread. Threads with a parent thread id are child sessions of the parent (titled from the thread index, else the agent nickname). The latest excerpt comes from `task_complete.last_agent_message`, assistant `output_text` items, or the last function/tool call name. Working directories lose the `\\?\` prefix Codex 0.166 records.

**Compressed rollouts** are decompressed in memory as a stream, never written anywhere, and read like a long plain rollout: the first 256 KB for `session_meta`, the last 512 KB for the latest state, and the latest plan lines before that. Each file is read once per change, up to 1 GiB decompressed (beyond that, metadata only). The first scans after start spend about 2 seconds each on them, newest first, until all are read; a single large file can take longer.

**State database.** Only the columns `id`, `cwd`, `name`, creation and update times, `source` (for the parent thread), `git_branch`, `cli_version`, `agent_nickname` and `agent_role` are read, and the parent links in `thread_spawn_edges`. `title`, `first_user_message` and `preview` hold the start of your first prompt and are never read; neither are `thread_history_*.sqlite` (the transcripts), `logs_*.sqlite` or the other Codex databases. The database is opened read-only, only when it is in WAL mode, and in a way that creates no file and takes no blocking lock: `mode=ro` while Codex has it open (its `-wal` and `-shm` files exist), else `immutable=1`, discarding the result when the file changed during the read. A thread listed there without a readable rollout is shown with state *Unknown · only thread metadata is available*; its last update time is never read as running or finished. Without the database (Codex 0.165 and earlier) repobs reads rollouts only; another generation (`state_6.sqlite`), another journal mode or an unknown table layout is reported in Diagnostics and not read.

Lifecycle mapping: `event_msg` `task_started` → turn in progress; `task_complete` → completed; `turn_aborted` → interrupted; `*_approval_request` → approval requested; `request_user_input` → input requested; `error` → error. The approval and input request names follow the Codex protocol but were **not observed** in local logs during development; they are covered by synthetic fixtures only.

**App server.** A Codex app-server reports `thread/status/changed` and approval flags only for threads that *that server* owns. repobs does not start one, and passive rollout reading cannot observe every approval wait of an independently running Codex process; such sessions show *Running* or *Unknown*, never a guessed *Awaiting approval*.

## Latest-message excerpts

On by default (owner decision, [ADR 0003](decisions/0003-dashboard-commit-graph-and-excerpts.md)); Settings → Privacy turns them off, after which adapters stop extracting them. Excerpts are capped at 280 characters, have whitespace collapsed and obvious secrets (private keys, `sk-`/`ghp_`/`github_pat_`/`xox*-` tokens, AWS keys, JWTs, `Bearer` values, `password=…`-style assignments) redacted, and exist only in memory and in the live snapshot sent to your paired browser — never in the database, logs, diagnostics or exports.

## Agent plans

On by default ([ADR 0009](decisions/0009-agent-plans-in-checklists.md)); Settings → Privacy turns them off. Only structured plan tool calls are read, replayed in transcript order; free text is never interpreted.

| Source | Tool call | Treatment |
| --- | --- | --- |
| Claude desktop app task list | `mcp__ccd_turn__update_plan` with `items` (full list), `advance`, or `done` + `start` (1-based) | Full lists replace; steps are replayed; without a full list there is no plan |
| Claude desktop app wrap-up | `mcp__ccd_turn__wrap_up` | Completes the step in progress |
| Claude Code to-do list | `TodoWrite` with `todos` | Each call is a full list |
| Claude Code tasks | `TaskCreate` / `TaskUpdate` and their successful structured results | Create by returned task id; replay confirmed status/subject changes and deletions; orphan updates are ignored |
| Codex | `update_plan` function call with `plan` | Each call is a full list |

The plan is rebuilt by replaying the calls in transcript order (`apps/server/src/sessions/plan.ts`):

1. A **full list** (`items`, `todos` or `plan`) replaces everything before it. Item text is the agent's own `content` or `step`; the status is its own `pending`, `in_progress` or `completed`. Any other status reads as pending.
2. **advance** completes the step in progress and starts the next pending one.
3. **done** + **start** complete the listed steps and start the named one; numbers count from 1.
4. A **wrap-up** completes the step in progress. Pending steps stay pending: ending a turn says nothing about them.
5. Steps or wrap-ups with no full list before them give **no plan**; a list is never guessed.
6. **Claude Code tasks** use request/result correlation in `sessions/claude-plan.ts`. Only successful, matching structured results create or change known tasks. Subjects become checklist text; descriptions are not retained. Unknown statuses and dependency-only edits leave the last known state alone. Failed/unconfirmed calls and updates to unknown ids do not invent tasks. Reused ids replace the corresponding old item; duplicate results alone do not create duplicates. A full-list replacement clears the task items and selects that plan source again.

For example, a list of four steps with the first in progress, then *advance*, then *done [2], start 4*, gives: 1 and 2 completed, 3 pending, 4 in progress.

Each item has a key: a hash of its text (and occurrence, for repeated texts). Your ticks on agent steps are stored by that key, without the text, and shown in place of the agent's status. A new list with the same wording keeps your ticks; a reworded step is a new item. New lines appended to a transcript are read as they arrive and fed to the same replay, so plans follow the agent while it works.

Observed on the owner's machine (November 2026) for the Claude desktop task list and Claude Code `TaskCreate`/`TaskUpdate` with `toolUseResult` envelopes. Unknown or ambiguous batched result formats are ignored. `TodoWrite` and Codex `update_plan` follow their published shapes and are covered by synthetic fixtures only. Plan text stays in memory.

## Reading strategy

Transcripts can be tens of megabytes. On first sight repobs reads a bounded head (256 KB, for metadata) and tail (512 KB, for the latest state); afterwards only appended bytes. Partial last lines wait for completion; lines are split on newline bytes so multi-byte UTF-8 characters are never cut; truncated or replaced files are re-read from scratch; over-long lines (> 4 MB) are skipped. When the tail of a long transcript holds no full plan list, repobs scans backwards from the skipped part (lines prefiltered by planning tool names and Claude structured result envelopes, at most 64 MB) to replay earlier plan records. Full lists supersede earlier records; incremental task lists recover known creations and updates within that bound. This recovery also applies to subagents (16 KB head, 64 KB tail) and large appends. Tasks whose creations lie outside the bound cannot be recovered, so a task list can be partial. Directories are watched (`fs.watch`) and re-listed on a timer, so missed events are recovered.

## GitHub pull requests (optional)

Off by default. When enabled in **Settings → GitHub pull requests**, repobs runs the GitHub CLI read-only:

```text
gh pr list --repo <owner>/<repo> --state open --limit 100 --json number,title,url,headRefName,baseRefName,state,isDraft,updatedAt,headRepositoryOwner
```

for each registered repository whose `origin` (or first) remote is on github.com, every *N* minutes (default 10). It uses your existing `gh` login; repobs never logs in for you and stores no token. PRs are shown as **remote metadata** (`PR #42 → main`, with the time they were fetched) on matching branches; fork PRs are not matched to local branches. Offline, unauthenticated or missing `gh` is reported as such, and core features keep working. Disabling the integration removes the cached PR data from the view.

## Other harnesses and VS Code

Other agents can be added as new adapters behind the same interface (`apps/server/src/sessions/types.ts`). A VS Code extension would be a thin client of the same local API; nothing in repobs depends on VS Code.
