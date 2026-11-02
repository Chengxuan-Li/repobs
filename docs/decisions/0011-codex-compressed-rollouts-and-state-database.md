# 0011 — Codex compressed rollouts and state database

- Status: accepted (2026-11-02, delegated by the owner's session for checkpoint 32). Implemented on `feature/non-git-folders`.
- Extends [ADR 0001](0001-product-foundation.md) (metadata-only agent observation, read-only sources) and the Codex section of [integrations](../integrations.md). The privacy rules of [ADR 0003](0003-dashboard-commit-graph-and-excerpts.md) and [ADR 0009](0009-agent-plans-in-checklists.md) are unchanged.

## Context

Checkpoint 32 found that most Codex threads on the owner's machine were invisible to repobs. Investigated on 2026-11-02 against Codex app 26.1027 with `codex-cli 0.166.0-alpha.5.1`, using read-only scripts that printed structure and counts only (no titles, prompts or paths):

- **Rollouts are compressed, not removed.** `~/.codex/sessions/` holds 303 `rollout-*.jsonl.zst` files and 11 plain `rollout-*.jsonl` files. Every `.zst` file starts with the zstd frame magic and decompresses to the same JSONL records as a plain rollout (`session_meta`, `event_msg`, `response_item`, `turn_context`, plus `world_state`, `compacted`, `inter_agent_communication_metadata` and `token_usage_record`, which repobs ignores). The repobs adapter matched only `*.jsonl`, so it saw 11 of 314 rollout files.
- **`state_5.sqlite` indexes every thread.** Its `threads` table has 288 rows. For each row, `rollout_path` names a `.jsonl` file: 9 exist as named, the other 279 exist with `.zst` appended, none is missing. So the earlier figure "279 of 286 threads have no rollout file" counted compressed rollouts as missing. 251 rows are sub-agent threads (`thread_spawn_edges` has 251 rows), 3 are guardian reviews, 33 were started by the user, 1 by an agent. All 288 have `history_mode = 'legacy'`, and all `cwd` values carry the `\\?\` prefix.
- **Prompt text is in the state database too.** `threads.title` equals `first_user_message` and `preview` in 281 of 288 rows: Codex uses the start of the first prompt as the title. `threads.name` is the thread name shown in the Codex app (35 rows, the same as `session_index.jsonl`).
- **The full history moved to another database.** `thread_history_1.sqlite` (379 MB, tables `thread_turns`, `thread_items`, …) holds transcript content. repobs must not read it.
- **Opening a database read-only can still create files.** Codex keeps `state_5.sqlite` in WAL mode and opens it only while it works on it: between uses there is no `-wal` or `-shm` file. Experiments on a synthetic WAL database with Node 24.21's `node:sqlite` (SQLite 3.53.4):
  - `mode=ro` **creates** an empty `-wal` and a 32 KB `-shm` when they are absent, and leaves them behind on close. The first inspection of the real database did exactly that; the two files were left in place because Codex was running, and Codex removes them on its own next clean close.
  - `immutable=1` creates nothing and takes no locks, but ignores the contents of a `-wal` file.
  - A `mode=ro` reader inside an open read transaction does not block a writer; a checkpoint run at the same time completes partially and Codex finishes it later. Writes through the read-only connection are refused.
- Node 24's `node:zlib` has `createZstdDecompress`, without an experimental warning, on the pinned runtime (`>=24.11 <25`).

## Decision

### 1. Read compressed rollouts like plain ones

- The adapter discovers `rollout-*.jsonl.zst` next to `rollout-*.jsonl` in `sessions/` and `archived_sessions/`. When both forms of one rollout exist (Codex is compressing it), the plain file is read and the compressed one ignored.
- A compressed file is decompressed as a stream with `node:zlib`; nothing is written anywhere, and no decompressed copy is kept. repobs feeds the accumulator the same bounded view it uses for a large plain file: the records of the first 256 KB (for `session_meta`) and of the last 512 KB (for the latest lifecycle, excerpt and plan). Lines in between are not parsed. When the tail has no plan and plans are read, the latest few lines before the tail that contain a plan marker are kept while streaming and replayed, as `scanBackward` does for plain files.
- Codex does not append to compressed files, so each one is read once per change of size or modification time.
- **Bounds.** At most 1 GiB of decompressed data per file (a guard against oversized or hostile files): beyond it the file contributes its head only, its state is *Unknown*, and `rollout_too_large` is reported. Decompression is spent at most about 2 seconds per scan; files not reached are read on later scans and `compressed_rollouts_pending` is reported until all are read. Plain rollouts are always read first.
- State, excerpts and plans from a compressed rollout follow the existing rules (`codex.rollout`, inferred from records, stale evidence becomes *Unknown*). Compressed rollouts are historical in practice, so their sessions are usually *historical* by age.

### 2. Read `state_5.sqlite` as a metadata index

**Whether.** Yes, but only the `threads` and `thread_spawn_edges` tables, only metadata columns, and only when it can be done without creating files in the Codex home or taking a lock that could block Codex.

**Columns.** From `threads`: `id`, `cwd`, `name`, `created_at_ms`, `updated_at_ms` (else `created_at`/`updated_at` in seconds), `source`, `git_branch`, `cli_version`, `agent_nickname`, `agent_role`. From `thread_spawn_edges`: `parent_thread_id`, `child_thread_id`. The query names its columns; it never selects `title`, `first_user_message` or `preview` (prompt text), and nothing else from the database. `thread_history_*.sqlite`, `logs_*.sqlite` and the other Codex databases are never opened.

**Opening rules.** `state_5.sqlite` is read with `node:sqlite` in read-only mode, one short query per change, and closed at once:

1. Read the file header. Byte 18 = 2 means WAL. A database in another journal mode is **not opened** (`state_db_unsupported`), because a reader in rollback-journal mode takes a shared file lock that blocks Codex's writers.
2. When the `-wal` and `-shm` files both exist (Codex has the database open), open with `mode=ro`: the ordinary concurrent WAL reader, which sees committed data, never writes the database or the WAL, and does not block Codex. Like every SQLite reader it marks its snapshot in the shared-memory index. If Codex closes the database and removes both files in the instant between the check and the open, the open recreates them empty; Codex removes them again on its next clean close. This race is accepted.
3. Otherwise open with `immutable=1`, which creates no files and takes no locks. The database file is stat-ed before and after the query; when it changed or companion files appeared meanwhile, the result is discarded and the read is retried on the next scan.
4. A busy or failed open, a query error, or a missing required column (`id`, `cwd`) reports a problem and keeps the last good snapshot; nothing fails.

The database is re-read only when the database, `-wal` file or companion presence changes. A database named `state_<n>.sqlite` with another generation number is not read (`state_db_unsupported`): its schema is unknown.

**Use.**

- **Titles.** The thread `name` is a title when `session_index.jsonl` has none for the thread.
- **Threads without a readable rollout** appear as *metadata-only* sessions: the rollout was not found, is still waiting to be decompressed, or a future Codex keeps history only in its history database. They get the thread id, working directory, start and last-update times, recorded branch, CLI version, parent thread (from `source.subagent.thread_spawn.parent_thread_id`, else `thread_spawn_edges`) and agent nickname or role.
- When a thread has a rollout, the rollout is the source: only the title falls back to the database.

**Confidence.** A metadata-only session's state is *Unknown*, confidence `unknown`, source `codex.state-db`, new reason `metadata_only` ("Only thread metadata is available; no turn records were read"), with `observedAt` set to the thread's last update. `updated_at` is never turned into *Running*, *Idle* or *Ended*, and Codex's `archived` flag is not read: neither proves the state of a turn. Such sessions count toward their parent's sub-agent total, never toward its active sub-agents. They are *historical* by the usual age rule.

### 3. Forked sub-agent rollouts

A forked sub-agent's rollout starts with its own `session_meta` and then repeats its parent's (observed in 6 compressed rollouts). The adapter let the last one win, so the file was credited to the parent. The first `session_meta` now names the file's thread; a later one for another thread is ignored, timestamps included.

### 4. Working directories

Every Codex working directory, from rollouts and from the database, has the Win32 namespace prefix removed (`\\?\C:\x` → `C:\x`, `\\?\UNC\server\share` → `\\server\share`) in the adapter, so suggestions, matching and the details panel use the plain path.

### 5. Degradation

| Situation | Behaviour |
| --- | --- |
| No `state_5.sqlite` (Codex 0.165 and earlier) | Rollouts only, as before; no problem reported |
| A `state_<n>.sqlite` of another generation, or a non-WAL database | Not opened; `state_db_unsupported`; rollouts only |
| Database present but `threads` lacks `id` or `cwd` | `state_db_unrecognized`; rollouts only |
| Database locked, corrupt or unreadable | `state_db_unreadable`; the last good snapshot is used |
| Node without zstd | Compressed rollouts are skipped with `compressed_rollouts_unsupported`; their threads stay metadata-only when the database lists them |
| A compressed file that does not decompress | `rollout_unreadable`, as for a plain file |

## Consequences

- On the owner's machine every Codex thread becomes visible with its recorded lifecycle, instead of 11 rollout files' worth. A headless check (real `~/.codex`, read-only, counts only) found 288 threads: 89 metadata-only after the first scan, none after the fifth (scans of about 2 s, one of 4.4 s because a single large file overruns the budget), 287 *Idle / turn finished* and 1 interrupted, no `\\?\` prefix left, and the Codex home listing unchanged.
- The budget is checked before each file, so one large compressed rollout can make a scan longer than 2 seconds.
- A small, known coupling to Codex's private schema: the column names above, the file name `state_5.sqlite`, and WAL mode. A schema change degrades to rollouts only, never to a failure.
- **Unverified.** Codex's compression trigger and timing (there is a `rollout-migrations` folder, empty here, and a `legacy_to_paginated_v1` migration marked complete); the history modes other than `legacy`; `archived_sessions/` with compressed files (empty here); a WAL database left with only one of its two companion files (read with `immutable=1`, which ignores the WAL; tested synthetically only).
- **Not done:** reading `thread_history_*.sqlite` (transcript content); showing token counts, model or sandbox policy from the database; a setting to turn the database off separately from the Codex source.
