# Security policy

repobs is a localhost developer tool, but a localhost service **still has access to sensitive local developer metadata**: repository paths, branch names, session titles and working directories. Please treat it accordingly.

## Reporting a vulnerability

Do not open a public issue for security problems. Until a public repository with private vulnerability reporting exists, report privately to the maintainers of the repobs repository you obtained this code from, with steps to reproduce, the affected version (`/api/v1/health`) and your platform. Expect an acknowledgement within a week.

## Threat model

**In scope**

- Websites in your browser attempting to read or change repobs data (cross-origin requests, CSRF, DNS rebinding).
- Malicious content in registered repositories (file names, refs, configuration) affecting repobs' parsing or process spawning.
- Leakage of private data (transcript content, tokens, paths) through logs, exports, diagnostics or the network.
- Corruption or loss of app-local data (annotations).

**Out of scope**

- Malware or other processes running as your Windows user (they can read your profile directly).
- Network attackers: repobs listens on 127.0.0.1 only and makes no network requests unless you enable the GitHub integration.

## Allowed operations

- Git: only `--version`, `rev-parse` (path/identity flags), `worktree list --porcelain -z`, `status --porcelain=v2`, `for-each-ref` (fixed format), `remote -v`; spawned with argv and `shell: false`, `--no-optional-locks`, `core.fsmonitor=false`, no pager or prompts, bounded time and output. Anything else is rejected before a process starts.
- Provider files: read-only, structural fields only; `*.key` files in the Claude registry folder are never opened.
- GitHub CLI: `gh pr list` only, only after opt-in.
- Windows folder picker: a fixed PowerShell script without user input.
- Writes: only inside the app data folder (`%LOCALAPPDATA%\repobs` or `REPOBS_DATA_DIR`).

## Controls

Loopback binding; Host and Origin validation; no CORS; single-use launcher pairing tokens in the URL fragment; signed `HttpOnly; SameSite=Strict` session cookies with logout revocation; session-bound CSRF tokens; JSON-only, size-limited, schema-validated bodies; strict Content-Security-Policy; text-only rendering of notes and provider text; log redaction of tokens and profile paths; integrity checks and backups for the database.

## Known limitations

- `git status` may run configured clean/smudge filters (e.g. Git LFS), as Git itself does; register only repositories you trust.
- Browser cookies are not port-specific, so other local web servers on 127.0.0.1 receive the (unforgeable) repobs cookie.
- A recorded Claude Code process id could be reused by an unrelated process; liveness is evidence, not proof.
- The app data folder relies on your profile's default Windows ACLs.
