# Getting started

## Prerequisites (Windows)

- **Node.js 24 LTS** (24.11 or newer) from <https://nodejs.org/>. `node --version` should print `v24.x`.
- **Git for Windows** on `PATH` (`git --version`).
- A modern browser (Edge, Chrome or Firefox).
- No administrator rights, editor, API keys or GitHub account are needed.

## Install and start

From a PowerShell prompt (a profile path containing spaces is fine):

```powershell
git clone <actual-repobs-url>   # placeholder until a public remote exists
cd repobs
npm ci
npm run build
npm start
```

`npm start` starts the service on `http://127.0.0.1:47321` (or the next free port up to 47330), waits until its health check passes and then opens your default browser with a **one-time pairing link**. Keep the window open; press **Ctrl+C** to stop repobs cleanly.

Alternatively run the Windows launcher, which also installs and builds on first use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

If repobs is already running, `npm start` (or `npm run open`) simply opens a new pairing link for the running instance. A browser tab that was not opened through the launcher shows *"This browser is not paired with repobs"* and no data.

## Register repositories

1. Click **Add repositories** (on the empty dashboard, or **Add** in the repositories panel).
2. Tick the candidates — repositories found in the working directories of your existing Claude Code / Codex sessions, with their session counts and last activity (repobs never scans your disk) — or type a path (for example `C:\src\my-project`) and press **Add to list**, or click **Browse…** for the native Windows folder chooser. Any folder inside a repository works, including a linked worktree; repobs registers the whole repository (its common Git directory) once.
3. Click **Add N repositories**. Each path reports success or its own error.

The dashboard (*View 0*) immediately shows each repository's branches and commits on a timeline, with the agents that worked on each branch as cards. See the [User guide](user-guide.md) for views, filters and arranging the panels.

## Verify that sessions are detected

Open **File → Diagnostics**. For each provider it shows whether its folder was found, how many session files are tracked, how many sessions belong to registered repositories, and any (sanitized) problems. Sessions outside registered repositories are counted but not shown.

## Try it without your own data

```powershell
node scripts/demo.ts C:\temp\repobs-demo
```

This builds disposable repositories and synthetic Claude/Codex session folders and prints the environment variables (`REPOBS_DATA_DIR`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) to start an isolated repobs on them.

## Stop and uninstall

- Stop: Ctrl+C in the `npm start` window.
- Uninstall: delete the repobs folder and the app data folder `%LOCALAPPDATA%\repobs` (database with your annotations, install secret, logs). Nothing else on the system is changed.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| *Git is not installed or not on PATH* (status bar shows *Monitoring degraded*) | Install Git for Windows and restart repobs. |
| *repobs needs Node.js 24* | Install Node.js 24 LTS. |
| Port in use | repobs tries the next 9 ports automatically; set `REPOBS_PORT` to choose another range. |
| *Git refuses this repository because of its ownership* | Git's `safe.directory` protection; repobs does not change Git configuration. Run `git config --global --add safe.directory <path>` yourself if you trust it. |
| No sessions appear | Check Diagnostics: the provider folder may be elsewhere. Set it in **Settings → Session sources**, or via `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. |
| *This pairing link is invalid, expired or already used* | Run `npm run open` for a fresh link (links last 5 minutes and work once). |
| The database was unreadable | repobs moved it aside (named `repobs.db.corrupt-<time>`), started fresh and reports this in Diagnostics. Your old annotations are in that file. |

Logs are in `%LOCALAPPDATA%\repobs\logs\server.log`.
