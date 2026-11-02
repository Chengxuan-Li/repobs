# 0010 — Folders without Git

- Status: accepted (owner request, 2026-11-02). Implemented on `feature/non-git-folders`.
- Extends [ADR 0001](0001-product-foundation.md), decision 2 (repository → branch → worktree → sessions). The read-only rules and the metadata-only agent observation are unchanged.

## Context

Agents also work in folders that are not Git repositories: scratch folders, data and document folders, folders that become repositories later. Until now repobs showed a session only when its working directory lay inside a worktree of a registered Git repository. Everything else was counted in Diagnostics and not shown, and the *Add repository* dialog silently skipped suggested working directories that Git did not recognise.

## Decision

### A folder is a second kind of registration

- `Repository.kind` is `git` or `folder`. A folder has no common Git directory (`commonGitDir` is omitted), no branches, no commit graph and no pull requests. Its id is `folder_` plus 12 hex characters of the SHA-256 of its path key, next to the existing `repo_` ids.
- Registration is explicit, as for repositories: you add a folder; repobs never shows unregistered folders on its own. Keeping one entity means the repositories panel, ordering, renaming, per-view hiding, filters, annotations and automation rules work for folders unchanged.
- Storage: migration 4 adds `repositories.kind` (default `git`). Folders store an empty `common_git_dir`. The database is backed up before migrating, as for earlier migrations.

### Which folders can be registered

- An absolute local path to an existing directory, as for repositories.
- **Refused:** a drive or file-system root, your home directory, and any folder that contains your home directory (`C:\Users`). Claude Code and Codex sessions often run in the home directory; registering it would collect almost every session on the machine.
- **Refused: a folder inside a Git repository** (`inside_repository`). It belongs to that repository; register the repository instead. This is checked with the same read-only `git rev-parse` call used to resolve repositories.
- A folder may *contain* Git repositories. See the matching rule below.

### Matching sessions

- A folder has one stand-in worktree at its path (`isPrimary`, never `detached`), so the existing association rule applies unchanged: the session's canonical working directory must lie inside the root, and **the deepest root wins**. A registered Git repository inside a registered folder therefore keeps its own sessions. Sessions in an unregistered repository inside the folder are shown under the folder; their recorded branch stays visible as recorded, not as today's checkout.
- When the folder no longer exists, its sessions become *unassigned* (`worktree_removed`, `cwd_missing`) as for removed worktrees, and the folder shows a scan error until it is back or removed from the dashboard.

### What repobs reads from a folder

- Only whether the path exists and is a directory, on the structure poll (`monitoring.idleWorktreePollMs`).
- No working-tree status, no file counts, no file watcher on the folder's contents, no indexing. Nothing is written to the folder.
- **Becoming a repository:** on each structure poll, repobs asks Git (read-only `rev-parse`) whether the folder is now inside a repository. If so, `Repository.gitDetected` is set and the dashboard says so, with the suggestion to add it as a repository. repobs never converts a folder by itself: you add the repository, then remove the folder entry. Annotations are keyed by session, so they follow the sessions.

### Suggestions

- *Add repository* (renamed *Add repository or folder*) lists working directories of agent sessions that are not covered by a registration. Directories inside a Git repository are merged into that repository as before; the others are offered as folders, one per working directory, marked *folder*. Paths that cannot be registered (missing, roots, the home directory and its parents) are not suggested.
- A manually entered path is tried as a repository first. When Git does not recognise it, the dialog offers to add it as a folder; it never falls back silently.

### API

- `POST /repositories` accepts `kind` (`git` by default, or `folder`).
- `POST /repositories/batch` accepts `folders` next to `paths`; each path reports its own result.
- `RepositorySuggestion.kind` says what the suggestion would register.

## Consequences

- **No Git timeline for folders:** a folder's board has one *Folder* row with agent bars on the shared axis, and no commits, branches or pending-changes markers.
- **Health:** a missing folder degrades the monitor's health like a repository scan error, so it is not silently empty.
- **Older versions:** a database migrated to schema v4 is not readable by 0.3.0 or earlier; the automatic backup is.
- **Not done:** grouping sessions by folder automatically without registration; network (UNC) paths, which stay out of scope as for repositories; converting a folder registration into a repository registration in one step.
