# Privacy & security

A localhost tool still sees sensitive developer metadata: repository paths, branch names, session titles and working directories. repobs is designed so that this information stays on your machine and is only shown to browsers you paired.

## What is stored, and where

| Item | Location |
| --- | --- |
| App database (registered repositories, settings, your annotations, minimal session records: id, title, cwd, association, timestamps) | `%LOCALAPPDATA%\repobs\repobs.db` |
| Install secret (signs pairing links and session cookies) | `%LOCALAPPDATA%\repobs\secret.key` |
| Runtime info (pid, port) | `%LOCALAPPDATA%\repobs\runtime.json` |
| Logs (rotated at 5 MB) | `%LOCALAPPDATA%\repobs\logs\server.log` |
| Pre-migration database backups | `%LOCALAPPDATA%\repobs\repobs.db.bak-v<N>-<time>` |

`REPOBS_DATA_DIR` overrides the folder. The folder inherits your profile's default Windows permissions (private to your account); on other systems files are created with mode 0600.

repobs **does not store** conversation text, prompts, tool output, code, diffs or secrets. From provider files it extracts structural fields and, unless you turn it off (Settings → Privacy), a short **latest-message excerpt** per agent: truncated to 280 characters, with obvious secrets redacted, held in memory and sent only to your paired browser — never written to the database, logs, diagnostics, annotation exports or File → Export files (which hold your annotations and view settings only). Unless you turn it off too, it reads the step lists agents keep with their planning tools (ADR 0009). These are also held in memory only; your ticks on them are stored by item key, without their text. User prompts are never extracted. Titles come from provider metadata (session name, custom title, thread name, subagent description) or a fallback built from the session id. Commit subjects from your repositories are shown in graph tooltips. Logs contain no request bodies, tokens or provider content, and paths under your profile are written as `~`.

## Network

- The server listens on `127.0.0.1` only (default port 47321, next free up to 47330).
- No telemetry, no update checks, no font or CDN requests (fonts are bundled), no model APIs.
- No Git remote is contacted: repobs never fetches. Remote refs come from your local clone.
- The only optional network use is the GitHub pull request lookup through your `gh` CLI, **off by default**; it sends owner/repository names to GitHub when enabled.

## How the local API is protected

- **Host and Origin checks** on every request reject foreign host names (DNS rebinding) and cross-origin requests; `Sec-Fetch-Site: cross-site` is rejected; no CORS headers are ever sent.
- **Pairing.** The launcher (which can read the install secret) opens `http://127.0.0.1:<port>/#pair=<token>`. The token is single-use, valid for 5 minutes, and sits in the URL fragment, which browsers do not send over the network; the page removes it from the address bar immediately.
- **Session cookie.** Pairing yields an `HttpOnly; SameSite=Strict` cookie signed with the install secret, valid for 12 hours; logout revokes it.
- **All private routes** — including the snapshot, the event stream, settings and diagnostics — require the session. Only `/api/v1/health` (name, version, monitor state) and the pairing endpoint are public.
- **CSRF.** State-changing requests must carry an `Origin` from the repobs origin, `Content-Type: application/json` and a CSRF token derived from the session (kept in page memory, never in storage).
- **Headers.** Strict Content-Security-Policy (`script-src 'self'`, no inline scripts), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `no-store` on API responses.
- **Input validation.** Every body is validated (zod), size-limited and length-limited. Repository paths must be absolute local directories inside a Git repository; there is no generic file or directory browsing endpoint.
- **Process safety.** Git and `gh` are spawned with argument arrays and `shell: false`, bounded time and output. Git commands pass through an allowlist of read-only inspections (`rev-parse`, `worktree list`, `status`, `for-each-ref`, `log` with a fixed format and bounded count, `remote -v`, `--version`) with `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, no pager, no terminal prompts, and `core.fsmonitor=false` so a repository's configuration cannot make `git status` launch an fsmonitor hook.
- **Rendering.** Notes and provider text are rendered as text (React escaping); no HTML or Markdown is interpreted.

## Threat model (summary)

| Threat | Mitigation |
| --- | --- |
| A website you visit reads or changes repobs data | Host/Origin checks, no CORS, SameSite=Strict cookie, CSRF token, JSON-only bodies |
| DNS rebinding | Host header must be a loopback name with the repobs port |
| Another local user / process on the same machine | Loopback binding limits exposure to this machine; the cookie and secret are needed for data. A process running as *you* can read your profile anyway and is out of scope |
| Malicious repository content (file names, config) | NUL-safe parsers, argv-only spawning, read-only allowlist, `core.fsmonitor=false`, text-only rendering |
| Leaking transcripts | Only structural fields plus an optional, truncated, redacted latest-message excerpt and the agents' plan steps are read into memory; nothing from transcripts is persisted or exported |
| Corrupt database | Integrity check at startup; the file is moved aside, a new one is created, and Diagnostics discloses it |

**Known limitations:** `git status` can run configured clean/smudge filters (for example Git LFS) exactly as Git itself would for racily-modified files; only register repositories you trust. Cookies are not port-specific in browsers, so other local web servers on `127.0.0.1` receive the repobs cookie (they cannot forge it). A recorded Claude process id could be reused by an unrelated process. See also `SECURITY.md` in the repository root and [Limitations](limitations.md).
