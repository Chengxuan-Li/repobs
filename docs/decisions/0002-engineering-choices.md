# 0002 — Engineering choices for v1

- **Status:** Accepted, 2026-10-30
- **Scope:** decisions delegated to engineering judgment by handoff section 9

## HTTP and push

Plain `node:http` with a small typed router (`apps/server/src/api/server.ts`) and zod validation; **server-sent events** for one-way push. No framework dependency, so security behaviour (Host/Origin checks, no CORS, cookie/CSRF handling, body limits) is explicit and fully tested. WebSockets are unnecessary for one-way updates.

## Running TypeScript

Sources use `.ts` import specifiers with `rewriteRelativeImportExtensions`; `tsc -b` emits JavaScript for production (`npm start` runs compiled code), while development (`npm run dev`) runs the server directly on Node 24's built-in type stripping (`--conditions=development` resolves the contracts package to its sources). This avoids `tsx`/`ts-node` and bundlers on the server.

## Persistence: `node:sqlite`

Node 24.21's `node:sqlite` (SQLite 3.53.4) works without warnings on the pinned runtime and needs no native build step on Windows. It is wrapped by `persistence/database.ts` (versioned migrations, pre-migration backups, newer-schema refusal, corrupt-file recovery) and `persistence/store.ts` (typed queries), all covered by tests. If the API changes, only these two modules are affected; `better-sqlite3` is the fallback.

## Accessible tree

A custom WAI-ARIA tree (`role="tree"`, `treeitem`, `aria-level/posinset/setsize/expanded/selected`, roving `tabIndex`) instead of React Aria Components: the tree must window its rows for hundreds of sessions, carry explicit accessible names that spell out state, and stay small. Keyboard: arrows, Home/End, Enter/Space, Shift+F10/Menu for a keyboard context menu. Covered by Playwright tests.

## State management

`useSyncExternalStore` over a small snapshot store fed by SSE diffs; no global state framework. View preferences live in `localStorage`; durable settings live on the server.

## Polling, coalescing and limits

500 ms monitor tick; status every 5 s for active worktrees (recent change or live session) and 30 s otherwise; repository structure every 30 s; sessions every 4 s; at most one status scan per worktree per 1.5 s; no overlapping ticks; four concurrent Git processes. Provider files: 256 KB head and 512 KB tail on first read, appends only afterwards, 4 MB line cap. Measured on this machine against real local data: 184 Claude sessions discovered in about 0.9 s cold and 40 ms incrementally (about 95 MB RSS).

## Status evidence

Only Claude Code's live-session registry (`~/.claude/sessions/<pid>.json`, `busy`/`idle`, process alive) is treated as *direct*. Everything derived from transcripts and rollouts is *inferred*; a pending tool call is never upgraded to *awaiting approval*. Codex approval/input events are mapped from protocol names but remain unverified against real logs.

## Folder picker

Windows-only native picker via a fixed PowerShell script (no user input; passed as `-EncodedCommand`); path entry is always available and is the fallback elsewhere.

Amended 2026-11-02: the script shows the shell folder dialog (`IFileOpenDialog` with `FOS_PICKFOLDERS`) instead of `FolderBrowserDialog`. The legacy dialog reports any failure as *Cancel* and was observed closing itself as *Cancel* about 1.5 s after opening, which the UI showed as nothing at all. The dialog is owned by a transparent topmost window on the monitor under the pointer, with a taskbar entry, and is brought to the foreground. The script prints an explicit `selected`/`cancelled` status; a missing status, a non-zero exit or the 10-minute timeout is an error (`picker_failed`, `picker_timeout`), never a silent cancel. The browser can stop waiting, which aborts the request and closes the dialog.

## Pairing and authentication

A per-install secret plus single-use pairing links (URL fragment) minted by the launcher, exchanged for an `HttpOnly; SameSite=Strict` signed session cookie with a session-bound CSRF token. Stateless signed sessions survive restarts; logout revokes in memory.

## Packages

Exact pins, npm workspaces, lockfile. Runtime UI: React 19.3, lucide-react, `@fontsource-variable/geist(-mono)` (OFL), zod 4. Tooling: TypeScript 6, Vite 8, Vitest 5, Playwright 1.63, ESLint 10 + typescript-eslint. Playwright uses the installed Microsoft Edge locally (no browser download) and Playwright's Chromium in CI.
