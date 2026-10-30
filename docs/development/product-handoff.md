<!-- Provenance: original product handoff supplied by the repository owner as
     docs/20261030-repobs-coding-agent-handoff.md on 2026-10-30; retained verbatim
     below as the agreed requirements (handoff section 5.1 step 2). -->

# repobs — Coding-Agent Development Handoff

**Version:** 1.0 — 2026-10-30  
**Status:** Approved product decisions; implementation authorized by this handoff  
**Project:** `repobs`  
**Tagline:** Local Git worktree and coding-agent observatory  
**Primary platform:** Windows 11; native Windows paths and tools first  
**Primary delivery:** Node.js localhost service with a browser UI  
**Later integration:** Optional lightweight VS Code extension, *not* a dependency of v1

> **START HERE — instructions for the implementing coding agent.** Treat this document as the single product and implementation brief. Create a new repository named `repobs` (or work inside an existing repository of that name if supplied), materialize the files specified below, then implement, test, document and commit coherent increments. The product decisions in §1 are settled; **do not repeatedly ask the owner to decide them**. Use bounded engineering judgment for low-level package choices. If an external dependency or harness format differs from the descriptions here, verify it, document the deviation, add tests, and continue with the safest conforming implementation. Never report a feature complete unless it works with real local Git and supported session fixtures. No mock data may be passed off as real data.

## 0. Objective and success definition

Build a **local-first, multi-repository, read-only Git and AI coding-session observability dashboard** for developers who have many Git worktrees, temporary agent-generated branches, and Claude Code/Codex sessions across projects.

The dashboard must answer, at a glance:

1. Which repositories have I registered, and what local and remote branches exist?
2. Which branches are checked out, and in which physical worktrees?
3. What is each worktree's state (clean, staged, unstaged, untracked, conflicts, rebase/merge/cherry-pick underway, ahead/behind, errors)?
4. Which **Claude Code** and **Codex** sessions are associated with each worktree, including sessions started *outside* repobs and **multiple sessions per worktree**?
5. Which sessions appear active, awaiting approval/input, inactive, or cannot be reliably classified?
6. What do **I**, independently of the agents, still need to check, review, annotate, or complete?
7. How can this view update automatically when Git and local agent data change, without manual rescanning?

**Release criterion:** A user on Windows can install, run `repobs`, register two existing repositories, see branches/worktrees and pre-existing Claude/Codex sessions with honest status/evidence, annotate several sessions, and observe changes without refreshing the browser. The app must never mutate a registered repository or modify agent histories. It must function with neither model API keys nor VS Code.

### Out of scope for v1 (do not implement as incidental features)

- Agent execution, prompting, stopping, approvals, orchestration, launching terminals, virtualenv activation, or shell command runners.
- Git mutation: no `git fetch`, pull, push, checkout, branch/worktree creation/removal, reset, merge, rebase, cherry-pick, clean, stash, commit, index staging, or conflict resolution.
- Automated LLM summaries, embeddings, hosted inference, agents inside repobs, or an LLM API requirement.
- Cross-machine transport, shared team state, collaboration, remote machine execution, WSL/SSH filesystem integration, container orchestration.
- A full Git commit DAG / GitKraken-like graph, a full chat transcript reader, a full IDE, and an embedded terminal.
- Required GitHub account or GitHub API use. PR lookup is an **optional, read-only integration** after core local discovery works.
- Automatically installing system-wide hooks or changing Claude/Codex configuration.

## 1. Non-negotiable product decisions

| Topic | Decision |
| --- | --- |
| Name / repository slug | `repobs` (lowercase; do not rename) |
| Primary information architecture | **Tree**: repository → branch → worktree → zero or more sessions; auxiliary groups for remote-only refs, detached HEADs, unassigned sessions |
| Agent content | **Metadata-focused**: title/identifier, provider, current activity/status, timestamps, working directory, optionally a short and privacy-conscious latest-activity preview; **not** a full transcript viewer |
| Git interaction | **Read-only with respect to Git and working files**; registering/removing monitored repos and changing app annotations are permitted app-local writes |
| Stack | TypeScript / Node.js backend; React + TypeScript + Vite frontend |
| Operating environment | Native Windows first; browser connects to a loopback-bound backend with filesystem access |
| Supported harnesses | Claude Code and OpenAI Codex CLI are mandatory minimums; other adapters are later extensions |
| Sessions per worktree | Many-to-one is expected and must work |
| Worktrees per branch | Under normal Git rules one checked-out worktree per local branch in the same common Git directory; handle exceptional/forced cases gracefully, but don't optimize for them |
| Branch identities | Preserve distinct local refs, remote-tracking refs, configured upstreams, local-only branches, remote-only branches, and detached HEADs |
| Updates | Event-driven where practical, supplemented by self-healing polling; no user-facing manual scan required for normal operation |
| Notes and review states | Authored only in repobs, never written into Git or agent transcripts |
| Documentation | MkDocs source in `docs/`; GitHub Actions builds and deploys **documentation only** to GitHub Pages |
| VS Code extension | Optional future thin client of the same backend; do not build in v1 |

**Important distinctions:** A *branch* points to a commit; a *worktree* is a physical working directory; a *session* belongs to a provider and may be associated with a worktree; *human review state* is not agent execution state; a *GitHub PR* is a remote review relationship from a head ref to a base ref, not a Git commit edge.

## 2. Source-of-truth UI and engineering references

### 2.1 EnergyAtlas UI (visual reference; read-only)

- Source repository: <https://github.com/Energy-Atlas/energyatlas-ui>
- Published reference: <https://energy-atlas.github.io/energyatlas-ui/>
- UI guidelines: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/docs/20260915_energyatlas_ui_design_guidelines.md>
- EnergyAtlas family styling decision: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/docs/decisions/0021-energyatlas-family-ui-alignment.md>
- Workbench layout decision: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/docs/decisions/0004-workbench-layout-and-docking.md>
- Unified panel component proposal: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/docs/ui-component-system.md>
- Current appearance tokens: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/src/index.css>
- Workbench implementation context: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/src/app/shell/WorkbenchShell.tsx>
- Reference agent conventions: <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/AGENTS.md> and <https://github.com/Energy-Atlas/energyatlas-ui/blob/master/CLAUDE.md>

**Use for design guidance, not as a runtime dependency.** Reference site rendering, code and documents may evolve; inspect exact current files when implementing and record the inspected revision in `docs/development/reference-audit.md`. Do not copy product-specific workflow, unpublished code, logos, proprietary content, or assets into repobs without licensing/provenance review. Repobs is a separate product.

Transfer the following visual principles:

- Desktop-density engineering workbench, compact hierarchy, precise alignment, square/rectilinear components, minimal decorative rounded cards or shadows.
- Geist for primary text and Geist Mono for paths, identifiers, code/status logs and small technical labels, with lawful package/license inclusion and legible Windows font fallbacks.
- Target font roles: label 11px, metadata 12px, primary 13px, pane/dialog titles 15px; meet accessibility and user scaling requirements.
- Light tokens as a starting palette: background/surface `#ffffff`; raised surface `#f8fafc`; text `#18202c`; muted text `#5f6b7a`; boundary `#cfd8e5`; accent `#125dae`; selection `#e7eff7`.
- Dark starting tokens: background/surface `#000000`; raised surface `#1a1a1a`; text `#e5e5e5`; muted `#999999`; boundary `#404040`; accent `#4da3ff`; selection `#0c1a29`.
- Shared semantic status colors: success/ready in green, warning/attention amber, error/destructive red, neutral/unknown quiet gray, info/selection blue. **Do not color a session green merely because a file was updated recently.**
- Thin major-pane rules, compact ruled headers, quiet icons/text, consistent hover/focus/selection treatment, comfortable keyboard navigation, no heavy nested-card chrome.
- A narrow global ribbon/toolbar and bottom status bar; a contextual inspection panel; purposeful density, not ornamental dashboard KPI tiles.
- Support light/dark/system. User-selected appearance must persist.

Repobs differs from EnergyAtlas in content: its main navigation is a Git/worktree/session **tree**, not an urban model or simulation workflow. Do not copy EnergyAtlas' 12-stage process, GIS/maps, charts, agent chat interface, or compute controls.

### 2.2 External technical references to inspect before binding adapters

- Git worktree docs: <https://git-scm.com/docs/git-worktree>
- Git status porcelain v2: <https://git-scm.com/docs/git-status>
- Git refs: <https://git-scm.com/docs/git-for-each-ref>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Codex App Server: <https://developers.openai.com/codex/app-server> (may redirect to current documentation)
- GitHub Pages custom Actions: <https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- MkDocs configuration: <https://www.mkdocs.org/user-guide/configuration/>

Agent transcript paths and on-disk formats are **implementation-dependent and may change**. Research and test what the installed tool actually writes. In late 2026, commonly observed defaults include Claude `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl` and Codex `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; these are **not stable public contracts**. Respect `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and configurable paths where applicable. Do not assume the directory name can always be inverted to the correct Windows path.

## 3. Initial user experience and layout

### 3.1 Workbench, first launch

A new user opens localhost in a browser. Show a proper, non-mock empty state and **Add repository** action. Let the user select/enter a local path through a local-backend-mediated native directory chooser or a validated text path; browser-side File System Access API is **not required**. Avoid arbitrary filesystem browsing endpoints. Register the repository; inspect its worktrees and branches immediately. Suggest already-recognized registered repos, but **never recursively index the user's entire home drive or disk without consent**.

Once registered, automatically surface:

- Current checked-out branch, local-only and upstream-tracking branches, remote-only refs, detached worktree heads.
- Physical worktree path, dirty/staged/unstaged/untracked/conflicted indicators, ahead/behind, Git operation state.
- Known Claude Code and Codex sessions mapped to these worktrees; historical and current sessions clearly distinguished.
- An unassigned-sessions group for ambiguous paths/removed worktrees; never silently invent an association.
- Optional PR indicators (when user enables and configures the read-only GitHub integration).

### 3.2 Default shell, desktop

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ repobs    [Add repository]    Search / filter    [All] [Attention]     ◐ Settings│
├──────────────────────────┬──────────────────────────────────┬──────────────────┤
│ REPOSITORIES             │ OVERVIEW / SELECTED ITEM         │ INSPECTION       │
│ ▾ Repo A                 │                                  │                  │
│   ▾ main · origin/main   │ Selected repo/branch/worktree/   │ Git and session  │
│     ▾ C:\...\repo-a       │ session details.                  │ metadata; human  │
│       ● Claude / running │                                  │ labels, notes,   │
│       ! Codex / review   │ At overview level: attention     │ checklist.       │
│   ▾ claude/a8de · local  │ queue and worktree roll-up.      │                  │
│     ▸ C:\...\worktrees\... │                                  │                  │
│   ▸ Remote-only (n)      │                                  │                  │
│ ▾ Repo B                 │                                  │                  │
│   ▸ ...                  │                                  │                  │
│   ▸ Unassigned sessions  │                                  │                  │
├──────────────────────────┴──────────────────────────────────┴──────────────────┤
│ 2 repos • 7 worktrees • 4 running • 2 need attention   Synced 14:32:16   Local│
└────────────────────────────────────────────────────────────────────────────────┘
```

This is an **information architecture sketch**, not literal styling or a requirement to reproduce exact sizes. Use a 260–340px resizable/collapsible left tree; center as the primary information pane; 300–360px optional right inspector; bottom live status. The user can navigate without opening multiple IDE windows. Save collapse/expansion, widths, selected object, filters, theme, and repository ordering.

**Do not build full drag-and-drop docking for MVP**: the reference uses FlexLayout, but a stable three-pane shell is sufficient and avoids scope inflation. Keep pane components and IDs clean so docking can be added later.

### 3.3 Tree grammar

- Repository nodes (registered clones are separate even when the remote URL matches). Distinguish a common Git repository from linked worktree paths using `git rev-parse --git-common-dir`.
- Group local refs by checked out, local-only, local with upstream, and remote-only, or use configurable sorting with clear badges. Avoid duplicating a local branch and its remote-tracking ref as two independent worktrees.
- Branch node shows canonical ref, upstream information, ahead/behind if meaningful; autogenerated `claude/...` or `codex/...` branches are **not** renamed by repobs. Optional custom *display alias* belongs in app-local metadata only.
- Branch may have **zero** physical worktrees; usually one; display all if Git reports an exceptional forced multiple checkout. Detached worktrees have their own group.
- Worktree node shows full path on tooltip/inspection; compact basename in row; clean/modified/conflicted summary; worktree locked/prunable/missing state when reported.
- Worktree node has **zero, one, or many** session children; no restriction that agents are distinct or one per branch.
- Session node shows provider icon/text, readable title or fallback ID, **observed execution state**, age/last activity, and distinct **human review** indicator.
- Provide a top-level filter for “Needs attention” and quick search (repo/path/branch/session title/user tags); never require reading private chat content for search.
- Tree control must support arrow navigation, expand/collapse, Enter selection, keyboard-accessible context menus, visible focus, text alternative to colored status, and large-list performance (virtualization if needed).

### 3.4 Inspector and annotation experience

When selecting a session, show identification (provider, session key, worktree, first/last known activity, current state with confidence/evidence, optional short event-type preview) plus local annotations:

- Custom tags, including flexible user-defined tags.
- Human work status, e.g. `Unreviewed`, `Needs review`, `Reviewed`, `Complete`, `Flagged`. This is independent of agent execution.
- Freeform scratch note; saved automatically, with visible save/error feedback.
- Checklist items with title, checked state, creation/completion timestamps and user-controlled ordering.
- When all checklist items are checked, **collapse or hide the completed checklist from the default view**; preserve it in a “Show completed” disclosure. Don't destructively delete the notes or list without explicit action.
- Inactive, deleted, or unassigned session annotations persist and can be recovered. A provider session disappearing must not delete human metadata.
- Optionally allow app-local repo/branch/worktree notes later, using the same annotation abstraction; mandatory initially for **sessions**.

Annotations are not GitHub issues; they are not transmitted to Claude/Codex, injected into prompts, written into repositories, committed, or posted anywhere.

### 3.5 Runtime states and truthful presentation

Define two **orthogonal** state dimensions:

**Observed execution status:** `running`, `running_subagents`, `waiting_approval`, `waiting_user`, `idle_or_turn_finished`, `ended`, `unknown`, `error`. An implementation may split `idle_or_turn_finished` when provider evidence supports it. Missing data is **unknown**, not idle. Background subagents imply still running. For ambiguous independent processes, use `unknown` / `possibly_active` in UI rather than claiming live status.

**Human workflow state:** `unreviewed`, `needs_review`, `reviewed`, `complete`, `flagged` (plus tags/checklist). These have no causal relationship with agent state.

Each observed status carries `source`, `observedAt`, `confidence` (`direct`, `inferred`, `unknown`), and optional non-sensitive reason. On stale evidence, downgrade classification. Activity timestamps never by themselves prove approval wait or successful completion.

**Short latest-activity preview** is optional: prefer safe structural labels such as “Tool executing”, “Turn completed”, “Awaiting permission”, without extracting raw prompt/code/secret-bearing transcript text. If enabling excerpts, add an explicit privacy setting, clearly state where data come from, truncate, redact sensitive patterns where feasible, and never persist raw excerpts by default.

## 4. System design

### 4.1 Monorepo layout to materialize

```text
repobs/
├─ AGENTS.md                        # canonical coding-agent instructions
├─ CLAUDE.md                        # Claude Code import of AGENTS.md
├─ README.md                        # user-facing quick start
├─ LICENSE                          # MIT, unless owner changes before publication
├─ CONTRIBUTING.md
├─ SECURITY.md
├─ CHANGELOG.md
├─ package.json                     # npm workspaces; exact versions/lockfile
├─ package-lock.json
├─ tsconfig.base.json
├─ .editorconfig
├─ .gitignore
├─ .env.example                     # only safe, non-secret examples
├─ mkdocs.yml
├─ requirements-docs.txt
├─ apps/
│  ├─ server/
│  │  └─ src/
│  │     ├─ index.ts
│  │     ├─ api/                     # validated HTTP endpoints and SSE
│  │     ├─ security/                # loopback, auth, Origin/Host, CSRF
│  │     ├─ git/                     # read-only Git discovery, status, refs, PRs
│  │     ├─ sessions/                # provider-neutral registry
│  │     │  ├─ adapters/
│  │     │  │  ├─ claude.ts
│  │     │  │  └─ codex.ts
│  │     │  ├─ registry.ts
│  │     │  └─ status.ts
│  │     ├─ monitoring/              # watchers, polling, reconciliation
│  │     ├─ persistence/             # app-local database and migrations
│  │     ├─ platform/                # Windows path, profile, process handling
│  │     └─ config/
│  └─ web/
│     ├─ index.html
│     ├─ vite.config.ts
│     └─ src/
│        ├─ app/                     # workbench shell, routing, state
│        ├─ components/              # shared primitives
│        ├─ features/
│        │  ├─ repository-tree/
│        │  ├─ git-inspector/
│        │  ├─ sessions/
│        │  ├─ annotations/
│        │  └─ settings/
│        ├─ theme/                   # tokens + themes + typography
│        └─ testing/
├─ packages/
│  └─ contracts/                     # zod schemas, shared TS domain types
├─ scripts/
│  ├─ start.ps1                       # Windows launch: backend + browser
│  ├─ dev.ps1
│  └─ ...
├─ fixtures/                         # synthetic Git + anonymized session fixtures
├─ tests/
│  ├─ git/
│  ├─ sessions/
│  ├─ persistence/
│  ├─ security/
│  └─ e2e/                            # Playwright tests
├─ docs/                              # MkDocs only; **no private sessions**
│  ├─ index.md
│  ├─ getting-started.md
│  ├─ user-guide.md
│  ├─ privacy-security.md
│  ├─ status-semantics.md
│  ├─ limitations.md
│  ├─ architecture.md
│  ├─ integrations.md
│  ├─ development/
│  │  ├─ reference-audit.md
│  │  ├─ testing.md
│  │  └─ handoff-status.md
│  ├─ decisions/
│  │  └─ 0001-product-foundation.md
│  └─ assets/
│     └─ repobs.css
└─ .github/
   ├─ workflows/
   │  ├─ ci.yml
   │  └─ pages.yml
   └─ ISSUE_TEMPLATE/
```

Adjust folder depths only when clearly warranted; preserve boundaries between Git inspection, provider adapters, metadata registry, human annotations, API contracts, and UI.

### 4.2 Technical defaults

- **Runtime:** Node.js 24 LTS (choose a tested patch release, document `engines`, pin with `.nvmrc` or `.node-version`); npm workspaces with lockfile. Avoid nonessential globally installed tooling.
- **Frontend:** React + TypeScript + Vite; CSS Modules + design tokens; Lucide or equivalent icon set; React Aria or an equivalently accessible tree/control implementation; `zod` schemas shared by backend/frontend. Prefer simple state management before adopting heavy global state frameworks.
- **Backend:** Node HTTP framework with small typed endpoints, structured errors, timeouts, validation, and server-sent events (SSE) for one-way push. SSE is adequate for live status; WebSockets are not necessary in v1.
- **Git:** Spawn installed `git.exe` using `execFile` / `spawn` with argument arrays and `shell: false`, strict timeouts, bounded output, no shell injection; use structured `-z`/porcelain output rather than human-facing lines. Don't scrape arbitrary GUI clients.
- **Persistence:** App-owned SQLite database under `%LOCALAPPDATA%\repobs\` (or documented override). Node 24 `node:sqlite` is a release-candidate API; validate actual stability on the pinned runtime, provide a tested persistence interface and migrations, and document any deliberate alternative. Never store application data in a monitored Git worktree by default.
- **Distribution:** `npm ci && npm run build && npm start`, plus Windows launch script that starts the loopback backend, checks health, and opens the URL in the user's browser. No admin rights or editor required. A packaged executable is a future nice-to-have, not release-blocking.
- **Config:** safe defaults, editable repo registration and adapter locations, no secrets in tracked files; settings persist app-locally.
- **PR integration:** optional read-only GitHub integration (e.g. authenticated GitHub CLI where available). It must not send repo names/paths over the network until explicitly enabled, and must work offline without PRs.
- **Extensions:** Treat VS Code as a future API client; UI and business logic must not import `vscode` or depend on an extension host.

### 4.3 Conceptual data model (refine into validated schemas)

The API and database should have stable IDs that survive refreshes and reordering:

```ts
// Illustrative contracts, not a requirement to use these exact field names.
type Repository = {
  id: string;               // stable within installation; common Git dir identity
  displayName: string;
  commonGitDir: string;
  primaryPath: string;
  selected: boolean;
  lastSuccessfulScanAt?: string;
  error?: string;
};

type BranchRef = {
  id: string; repoId: string;
  fullRef: string;            // refs/heads/x or refs/remotes/origin/x
  shortName: string;
  kind: 'local' | 'remote_tracking';
  tipOid: string;
  upstreamFullRef?: string;
  ahead?: number; behind?: number;
  // Remote-only is a derived display classification, not a third Git ref type.
};

type Worktree = {
  id: string; repoId: string;
  path: string;
  headOid?: string;
  branchFullRef?: string;     // undefined for detached heads
  detached: boolean;
  locked?: boolean; prunable?: boolean;
  status: {
    staged: number; unstaged: number; untracked: number; conflicted: number;
    gitOperation?: 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'bisect';
    unknown?: boolean;
  };
};

type ObservedAgentState = {
  kind: 'running' | 'running_subagents' | 'waiting_approval' |
        'waiting_user' | 'idle_or_turn_finished' | 'ended' |
        'unknown' | 'error';
  confidence: 'direct' | 'inferred' | 'unknown';
  source: string;
  observedAt: string;
  detail?: string;           // structured, non-sensitive metadata only
};

type AgentSession = {
  id: string;                // stable provider-scoped id, not basename alone
  provider: 'claude' | 'codex';
  providerSessionId: string;
  title?: string;            // supplied metadata or safe fallback
  observedCwd?: string;
  worktreeId?: string;       // null/unassigned if cannot safely match
  firstSeenAt: string;
  lastActivityAt?: string;
  state: ObservedAgentState;
  historical?: boolean;
};

type SessionAnnotation = {
  sessionId: string;
  displayAlias?: string;
  review: 'unreviewed' | 'needs_review' | 'reviewed' | 'complete' | 'flagged';
  tags: string[];
  note: string;              // plain text or sanitized Markdown; never a prompt
  checklist: Array<{
    id: string; text: string; done: boolean; order: number;
    createdAt: string; completedAt?: string;
  }>;
  updatedAt: string;
};
```

**Repository and worktree identity:** use Windows-aware canonicalization (`realpath` where possible, drive case normalization, separator consistency) and the actual common Git directory. Keep both raw/display and normalized paths. Do not collapse separate clones simply because they share `origin`; do not depend on random agent branch names to identify worktrees. Preserve prior identity and annotated sessions when paths disappear; disclose orphaned associations.

**Session identity:** combine provider + actual provider session/thread ID + provider-home/installation context if necessary to avoid collisions. Detect duplicate physical paths, relocated sessions and repeated imports without creating duplicate UI rows.

**Associations:** resolve session `cwd` to the *longest, canonical matching registered worktree root* with correct path boundaries; use Git repository metadata when necessary. If a session has moved between worktrees, record last-observed association and move the active link only with reliable evidence. A branch recorded historically in a transcript does not prove today's checkout. Unknown/no-match sessions go to an unassigned bucket.

### 4.4 Git reader: explicit read-only contract

Read information from Git via bounded commands resembling:

```text
git --no-optional-locks -C <registered-path> rev-parse --show-toplevel
git --no-optional-locks -C <registered-path> rev-parse --path-format=absolute --git-common-dir
git --no-optional-locks -C <registered-path> worktree list --porcelain -z
git --no-optional-locks -C <worktree-path> status --porcelain=v2 --branch -z
git --no-optional-locks -C <registered-path> for-each-ref ... refs/heads refs/remotes
```

Verify the exact Git syntax and output version on installed Git for Windows, particularly NUL-delimited worktree output, and prefer the safest supported documented format. Set `GIT_OPTIONAL_LOCKS=0` and disable external pagers/helpers where applicable; never invoke interactive or write-oriented commands. Avoid `git status` refreshing repository metadata when preventable. Never use `exec` with concatenated shell strings. Restrict allowed git subcommands in a single module and test the allowlist; any tool needing more than inspection requires a separate, explicit product decision.

Handle:

- unborn branches, missing upstreams, remote-tracking ref removed or renamed, duplicate branch names at different refs;
- clean, staged, unstaged, untracked and ignored files (ignored excluded by default); merge conflicts; rename records; filenames with spaces, Unicode, newlines and NUL-safe parsing;
- detached HEAD, linked worktrees with `.git` *files*, locked worktrees, prunable worktrees, removed worktree directories, rebase/merge/cherry-pick markers;
- repo root vs subdirectory registration, bare repositories (explain limited worktree display), permission errors, Git not installed, Git command errors;
- branch ahead/behind relative to **configured upstream**, not an assumed `origin/main`;
- local-only, remote-only, and tracking branches without silently running `git fetch` (remote refs are locally cached and could be stale).

For PRs: on explicit opt-in, resolve GitHub remote with repository-aware validation and list open PRs as **remote metadata**, including number, title, URL, head ref, base ref, state and last fetched time. Overlay e.g. `PR #42 → main` in branch inspector/tree. Never imply a PR is a local commit edge or that remote information is live when offline. Do not require hosting provider integration for the core app.

### 4.5 Session readers and adapters

Define a provider interface such as:

```ts
interface SessionAdapter {
  readonly provider: 'claude' | 'codex';
  discover(config: AdapterConfig): Promise<DiscoveredSession[]>;
  observe(session: DiscoveredSession): Promise<ObservedAgentState>;
  watch?(onChange: () => void): Promise<() => void>;
  diagnostics(): Promise<AdapterDiagnostics>;
}
```

**Mandatory behavior:** discover **pre-existing** terminal sessions, not only sessions repobs launched (repobs launches none), associate with worktree using observed cwd, read only required metadata, update incrementally, and survive provider version differences.

- **Claude Code:** inspect supported metadata/local session files and, where installed and documented, optional provider-reported state. Hooks (`PermissionRequest`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionStart`, `SessionEnd`, `CwdChanged`, etc.) can provide more precise events, but v1 **must not automatically install hooks**. Design an explicit opt-in hook/bridge later, with clear uninstall and no interference in approval decisions. A hook should only *report*, never approve or deny.
- **Codex:** discover CLI sessions in provider-home dated session storage and parse bounded rollout metadata (`cwd`, session ID, timestamps, turn lifecycle) where observed. An app-server instance can report direct `thread/status/changed` and approval flags for threads that **that server owns/has loaded**; do not claim that starting your own app-server observes arbitrary independently running Codex CLI processes. Passive log-only observation cannot reliably prove approval-waiting status in all situations.
- **Subagents:** include parent activity where supported; avoid double-counting independently logged subagents as top-level chats unless a real parent/child identity is known. While child work continues, parent may be displayed as `running_subagents`.
- **Session titles:** prefer provider-supplied title; otherwise stable fallback (`Claude session <short-id>`, `Codex session <short-id>`), with app-local aliases. Avoid automatically using raw user prompt text unless user opts in.
- **Large/partial files:** incremental cursor/read tail, file size/line caps, JSONL partial-write handling, UTF-8 boundary safety, file rotation/movement and log truncation. No full-file rereads every poll; do not accidentally load multi-GB histories into memory.
- **Compatibility:** versioned adapters; on unknown records return useful partial metadata and `unknown` state, log a sanitized diagnostic, and never crash the dashboard. Synthetic fixture variants should cover Windows, mixed Unicode, relocated paths and unknown schema fields.
- **No model connections:** no Claude or OpenAI API key; do not invoke model turns to extract names or summaries. Avoid executing a command that unintentionally launches an agent interaction.

### 4.6 Refresh, reconciliation and failure behavior

A single backend monitor owns the authoritative snapshot. Use a small event pipeline:

1. Start: restore configured repository entries and annotations; discover registered repos + provider session roots; build an initial snapshot.
2. Watch: monitor specific Git administrative paths and session files/directories; debounce bursts, coalesce work and use bounded concurrency.
3. Verify: periodically rescan registered repositories and session indexes to recover from missed `fs.watch` events (especially on Windows); use configurable bounded polling, e.g. short interval for active worktrees, longer for inactive ones. Avoid recursive watchers on millions of worktree files.
4. Reconcile by canonical IDs: additions, updates, vanished/moved sources, errors, and stale statuses; never wipe annotations when a source vanishes.
5. Publish compact versioned diffs over SSE; clients refetch full snapshot on reconnect/version gap. Display `lastUpdated` and errors separately from true activity.

No manual refresh should be necessary for normal changes. An optional **Troubleshoot / Rescan** command is acceptable for recovery, but not as the core update mechanism. Throttle, cap queues, and surface monitoring degraded/offline states rather than hiding failures. Avoid UI jumping/reordering during ordinary metadata updates; preserve the user's selection and expansion state.

### 4.7 API contract (minimum)

Expose validated JSON from localhost, for example:

```text
GET    /api/v1/health                   version / monitor health, no private paths
GET    /api/v1/snapshot                 normalized repos, refs, worktrees, sessions
GET    /api/v1/events                   SSE change events (authenticated)
GET    /api/v1/repositories
POST   /api/v1/repositories             register a validated local repository path
DELETE /api/v1/repositories/:id         unregister app-only; do NOT delete files
GET    /api/v1/sessions
GET    /api/v1/sessions/:id
GET    /api/v1/sessions/:id/annotation
PUT    /api/v1/sessions/:id/annotation  upsert human-owned metadata
GET    /api/v1/settings
PATCH  /api/v1/settings
GET    /api/v1/diagnostics               redacted adapter/watch health
```

Optional later `GET /api/v1/repositories/:id/pull-requests` behind an explicit GitHub integration. Do not expose arbitrary file-read endpoints or shell execution. `DELETE /repositories` means *remove from the dashboard configuration only*; display this plainly in UX and test it. Generate OpenAPI/spec or explicit schema docs from the shared contracts, avoiding hand-maintained incompatible DTO copies.

### 4.8 Security, privacy and local persistence

Even a localhost-only developer tool can leak sensitive paths, code, credentials or agent transcripts. Build defenses from day one:

- Bind to `127.0.0.1` by default (IPv6 loopback optional), not `0.0.0.0`.
- Check `Host` and `Origin`; reject cross-origin API requests by default; no permissive CORS. Defend against localhost DNS rebinding and cross-site state changes.
- Protect **all private API/SSE routes**, not only mutations. Provide a practical local pairing/session design: a high-entropy per-install secret established by launcher + a short-lived, HttpOnly/SameSite=Strict cookie or equivalent; require anti-CSRF proof for state-changing methods. Don't put long-lived secrets in URLs, logs, frontend bundles, or localStorage. A unauthenticated health endpoint must return minimal non-sensitive data only.
- Keep data and tokens in the user's local profile with restricted permissions. Document server logs and app-local database location. Do not persist raw conversation text, tool outputs, code, diffs or secrets by default.
- Sanitize rendered user notes and any provider text; prefer plain text over dangerous HTML; no untrusted Markdown HTML. Bound text and metadata sizes.
- Directory registration must validate it is a real local Git repository, not allow arbitrary paths to become a generic file server. Resolve symlinks/junctions and enforce path boundaries where reading session metadata.
- Safe process spawning with executable + argv; no shell-based string interpolation; bounded CPU, subprocess timeout, cancellation, output length and log redaction.
- Record no telemetry by default, no automatic external network requests, no silent GitHub login or Git remote contact.
- Add `SECURITY.md` with threat model, disclosure procedure, allowed operations and known limitations; include explicit warning that a localhost service still has access to sensitive local developer metadata.
- App-generated artifacts go into `%LOCALAPPDATA%\repobs` (with Windows permissions as supported); `.gitignore` excludes local databases, logs, `.env.local`, session fixtures containing real user data, and build output.
- Data migrations are reversible or backed up, versioned and tested. Include import/export of **human annotations** in sanitized JSON if practical; never export full provider transcripts.

## 5. Agent-oriented implementation protocol

### 5.1 Bootstrap first

1. Inspect the local working directory and current Git state before changing anything. If the project repository exists, do not overwrite its existing changes. If absent, create a new `repobs` folder/repository under the working directory supplied to you; do not silently create a GitHub remote, organization, or push destination.
2. Copy/retain this handoff at `docs/development/product-handoff.md` (or a dedicated `spec/` file) as the original agreed requirements, with date and provenance.
3. Write `AGENTS.md` and `CLAUDE.md` from the templates in §8, README, LICENSE, .editorconfig, .gitignore, package workspace scaffold, and MkDocs scaffold.
4. Run baseline package install/typecheck, a docs build, and the minimal Git status safety check; record commands/results in `docs/development/handoff-status.md`.
5. Build vertical slices below, adding tests/fixtures and meaningful commits. Never treat a working mock UI as the product.
6. When blocked by unavailable installed harnesses, implement/test adapters against **synthetic fixtures**, document live verification pending, and continue with other slices. Do not make up a successful live integration.
7. End with reproducible Windows startup instructions, verification evidence, specific remaining limitations and next steps. No unapproved force pushes or publication to a remote.

### 5.2 Phases and testable acceptance gates

| Phase | Work | Acceptance gate |
| --- | --- | --- |
| **P0** Foundation | Monorepo, strict TS, lint, test infrastructure, shared contracts, app-local storage, security shell, MkDocs/docs workflow, AGENTS/CLAUDE | `npm ci`, lint/typecheck/build/tests, `mkdocs build --strict` succeed; localhost health and browser shell; no real data mocked as observed |
| **P1** Git | Register/unregister repo, branch refs/upstreams, worktree discovery, local status, operation markers; Windows path normalization | Integration fixtures with 2 repos, main + scratch branches, separate worktrees, remote-tracking refs, dirty/conflicted states; read-only behavior verified |
| **P2** Tree UI | EnergyAtlas-inspired shell, register form, repository→branch→worktree tree, filters, inspector, persisted view settings, empty/errors | Playwright verifies full keyboard paths, large lists, theme, responsive usable layout, status explanation and no dead controls |
| **P3** Agent discovery | Claude + Codex adapters, historical sessions, multiple per worktree, session-to-cwd matching, safe metadata | Synthetic and available real-session smoke tests; false association/duplicate/stale cases; unknown states displayed truthfully |
| **P4** Live updates | Watcher + reconciliation polling + SSE, status observation, startup reconnect, source failure handling | External Git changes and appended synthetic agent metadata appear without browser refresh; no runaway polling; recovery on watcher loss |
| **P5** Human annotations | Tags, review flags, scratch notes, checklists, auto-hide completed checklists without deleting, durable storage | Multiple sessions on same worktree have independent notes; survive restart; moving/deleting session source preserves human metadata |
| **P6** PR/quality/release | Optional read-only GitHub PR metadata with opt-in; full Windows CI/e2e, docs, installer script, security audit, changelog | Core application operates offline; PR disabled state honest; one-command Windows launch; CI + docs Pages build green |

The agent may parallelize non-overlapping packages once contracts stabilize, but avoid integration races and unreviewed concurrent edits to the same files. Never sacrifice tests or architecture for a nominally faster completion.

### 5.3 Explicit test matrix

**Git:** two unrelated repos; common repository with several linked worktrees; local-only scratch branch; tracking branch; remote-only ref; upstream removed; detached HEAD; Unicode/spaces in Windows paths; path case differences; worktree deleted externally; staged/unstaged/untracked/conflicted file; rebase in progress; large repo; multiple known branches but only a few worktrees; exceptional forced duplicate branch checkout must not crash.

**Agent discovery:** two Claude and two Codex sessions attached to a single worktree; agents on two separate worktrees of one repo; existing sessions discovered on startup; session whose cwd moved; branch switched after session started; no matching worktree; old session files; partially appended JSONL; truncated/unrecognized metadata; missing provider installations; Codex app-server events unavailable; parent/subagent activity and ambiguous completion.

**UI/annotations:** concurrent agent updates while selected node is open; annotations retained across refresh, app restart, workspace deletion, and provider session disappearance; checklist all checked hides visually but can be recovered; search does not require chat raw text; stale data visible; keyboard-first tree navigation; theme persistence.

**Security:** localhost Host/Origin/CSRF tests; private API without session denied; invalid repo/path inputs; fake repository with malicious filename; command-injection arguments; unexpected executable behavior; denial of traversal outside approved roots; no Git mutating command executed; no outgoing network requests without PR opt-in; redaction of logs; notes rendered as literal text.

**Packaging:** Windows PowerShell with a typical account path containing spaces; first run, restart, occupied port, Git absent, Node version mismatch, corrupt app database (recover with backup and disclose error); browser opens only after healthy backend; clean shutdown and no orphan processes.

**Automated check commands** (create scripts with these names; document any equivalent):

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
npm run test:e2e
python -m pip install -r requirements-docs.txt
python -m mkdocs build --strict
```

CI must run tests on `windows-latest` as well as a general runner. Use actual disposable Git repositories from tests; avoid touching the developer's real repositories. Include Playwright screenshots as test artifacts only for *synthetic* data and prevent accidental publication of real session text.

## 6. MkDocs and GitHub Pages — required files and full workflow

The **public GitHub Pages site is documentation**, not a hosted instance of repobs. The app requires a local backend and must not expose user Git directories or transcripts to the public Pages build.

### 6.1 `mkdocs.yml` starter

Create this at repository root. Set canonical `site_url` and `repo_url` only **after the actual GitHub owner/remote is known**; do not invent an account. If project Pages are used, the canonical URL must include `/repobs/`.

```yaml
site_name: repobs
site_description: Local Git worktree and coding-agent observatory
site_author: repobs contributors
# site_url: https://ACTUAL-OWNER.github.io/repobs/
# repo_url: https://github.com/ACTUAL-OWNER/repobs
# edit_uri: edit/main/docs/
docs_dir: docs
site_dir: site
use_directory_urls: true
theme:
  name: mkdocs
nav:
  - Home: index.md
  - Getting started: getting-started.md
  - User guide: user-guide.md
  - Status semantics: status-semantics.md
  - Integrations: integrations.md
  - Privacy & security: privacy-security.md
  - Limitations: limitations.md
  - Architecture: architecture.md
  - Development:
      - Reference audit: development/reference-audit.md
      - Testing: development/testing.md
      - Handoff progress: development/handoff-status.md
      - Foundation decision: decisions/0001-product-foundation.md
extra_css:
  - assets/repobs.css
```

Use the built-in MkDocs theme for a conservative, low-maintenance default; apply a lightweight CSS variant informed by EnergyAtlas visual conventions. The docs do not need to duplicate the interactive app. `requirements-docs.txt` must pin a tested MkDocs release (for example, `mkdocs==1.6.1`, if compatible with the selected Python). Do not accidentally require Material for MkDocs; the built-in theme is adequate. Keep source links relative and the site self-contained.

### 6.2 `.github/workflows/pages.yml` — implementation-ready starter

```yaml
name: Documentation — MkDocs to GitHub Pages

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: github-pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: requirements-docs.txt
      - name: Install MkDocs
        run: python -m pip install -r requirements-docs.txt
      - name: Build documentation strictly
        run: python -m mkdocs build --strict
      - name: Configure Pages
        if: github.event_name != 'pull_request'
        uses: actions/configure-pages@v5
      - name: Upload Pages artifact
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v4
        with:
          path: site

  deploy:
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy documentation
        id: deployment
        uses: actions/deploy-pages@v4
```

**Before deployment** the owner/repo must exist on GitHub, `main` must be the designated default branch (or adjust the workflow), and the repo's **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**. Build on PRs, publish on main only. Pin third-party action versions/commit SHAs according to project security policy when stabilizing. Keep the `github-pages` environment constrained to the approved default branch if settings allow it. No tokens beyond the standard scoped `GITHUB_TOKEN`/OIDC deployment permissions are needed.

### 6.3 Required docs content

- `docs/index.md`: concise value proposition; local-only privacy statement; supported harnesses/platforms; screenshot using **synthetic** demo data when available.
- `docs/getting-started.md`: Windows prerequisites, install/start, register repo, verify sessions, stop/uninstall, Git missing and adapter troubleshooting.
- `docs/user-guide.md`: read tree, local/remote refs, worktree status, session mappings, review notes/checklists, filters.
- `docs/status-semantics.md`: direct vs inferred vs unknown evidence; stale data and what not to infer from file activity.
- `docs/integrations.md`: Claude/Codex local adapter locations, configuration overrides, what is and isn't monitored; optional PR lookups.
- `docs/privacy-security.md`: exact local storage location, network endpoints and controls, no default telemetry, threat model.
- `docs/limitations.md`: Windows-first, no cross-machine, no agent prompting, passive status limits, no full Git graph.
- `docs/architecture.md`: conceptual schemas, adapter boundary, reconcilers, SSE, API and future extension contract.
- `docs/development/reference-audit.md`: observed EnergyAtlas facts with URLs/revision + interpretation + deviations; no copied code without provenance.
- `docs/development/testing.md`: commands, fixture policies, CI matrix and test provenance.
- `docs/development/handoff-status.md`: dated implementation checkpoints, completed validations, known blockers and remaining work.
- `docs/decisions/0001-product-foundation.md`: settled five user decisions and their consequences; later changes as ADRs.

## 7. README, UX details and distribution requirements

README front matter should say **“repobs — observe your Git worktrees and coding agents, locally.”** Show a static screenshot only when the UI actually exists; a fabricated mock should be labeled as a mock. Explain clearly that the tool is **not** an agent launcher, IDE or Git mutator. Do not claim unsupported OS/harness features as working.

Suggested user commands (implement as npm scripts):

```powershell
# On Windows with Git and the supported Node.js installed:
git clone <actual-repobs-url>
cd repobs
npm ci
npm run build
npm start                    # starts loopback service, serves UI, opens browser

# Development:
npm run dev                 # backend watcher + Vite dev UI

# Documentation:
python -m pip install -r requirements-docs.txt
python -m mkdocs serve
```

`<actual-repobs-url>` is a placeholder until a real remote is created; never claim the repository is published. Use `scripts/start.ps1` for a frictionless Windows launch and a package script wrapping it safely. If startup runs in development mode, make it explicit and do not expose a Vite dev server as the production UI. Port selection needs a clear predictable mechanism, avoids collisions, and preserves auth behavior.

Allow configuration of session discovery roots and a diagnostics screen showing which adapters are available, the last scan time, relevant permission errors, and source evidence **without leaking private transcript contents**. The default app can be used offline after local dependencies are installed.

Keep a small, consistent component library: `WorkbenchShell`, `RepositoryTree`, `TreeRow`, `StatusIndicator`, `BranchInspector`, `WorktreeInspector`, `SessionInspector`, `AnnotationEditor`, `Checklist`, `EmptyState`, `InlineAlert`, `GlobalStatusBar`, `SettingsPanel`. No inert controls: every actionable UI control either performs a documented operation or is plainly unavailable with a reason.

## 8. Ready-to-create canonical agent instruction files

### 8.1 `AGENTS.md` (exact starter content; maintain as project evolves)

```markdown
# repobs — Agent operating instructions

Read `docs/development/product-handoff.md`, `docs/decisions/0001-product-foundation.md`, and `docs/development/handoff-status.md` before substantial work. This repository is a Windows-first, local-first Git worktree and coding-agent observability dashboard. Source control, provider data and personal annotations have separate ownership; never mix them.

## Authority and scope

- The handoff's approved decisions are authoritative: name `repobs`, tree-first UI, Claude Code + Codex metadata observation, read-only Git, TypeScript/Node backend, React/Vite frontend, MkDocs Pages docs.
- Build the app, tests, fixtures, documentation and deployment workflows. Do not implement Git mutations, agent execution, model calls, cross-machine monitoring or VS Code extension without an explicit new decision.
- Never modify external reference repositories. EnergyAtlas UI is a visual reference only.
- No automatic installation of hooks or edits to Claude/Codex configuration. Do not send agent transcript content to third-party services.

## Git safety and working discipline

- Inspect `git status --short --branch` and relevant files before edits; preserve pre-existing changes.
- Small focused commits with tests and updated docs are authorized when the current repository is clean enough. Do not hard reset, force push, delete branches, rewrite history, or discard changes. Do not create/push remotes without explicit instruction.
- Preserve configured human Git identity; never invent author details or add agent/model co-author trailers.
- Examine staged diff for private paths, transcripts, secrets, credentials and generated state before each commit.
- All application Git calls must be allowlisted **read-only inspections** and invoked using argv without a shell. Never execute mutating Git commands against monitored repos.

## Architecture and quality

- Source-of-truth domain contracts in `packages/contracts`; keep Git reader, Claude adapter, Codex adapter, reconciliation, persistence, HTTP API and UI independent.
- Each user-facing status needs source/evidence/confidence; never infer “waiting approval” from mere inactivity or last modified time. Prefer `unknown` over false certainty.
- Multiple sessions per worktree, local-only scratch branches, detached HEAD, and missing/unassigned worktrees are first-class cases.
- App-local annotations survive agent and worktree disappearance and are never written into transcripts or repos.
- Enforce localhost security, validation, safe process spawning, private app storage and opt-in network integrations.
- Keep UI consistent with the EnergyAtlas-derived design audit; do not copy unrelated energy application features.
- Use synthetic fixtures in automated tests. Never commit real session histories or user repository snapshots.
- Cover empty, loading, success, stale, permission-denied, disconnected and error states; no silent no-op controls.

## Verification and continuity

- Prefer a tested vertical slice over a broad mock. Run relevant typecheck, lint, tests, integration/e2e and MkDocs checks; log exact commands and outcomes.
- Record major choices in `docs/decisions/`; update `docs/development/handoff-status.md` after meaningful steps with what works, what was tested, what is unknown, and the next action. Conversation memory is not project state.
- When an installed Claude/Codex version lacks an expected feature, document observed behavior and ensure the UI reports partial/unknown state without failure.
- Finish with precise, reproducible Windows commands and note any unverified claims. Never say a suite passed unless it ran successfully.
```

### 8.2 `CLAUDE.md` (exact starter content)

```markdown
# Claude Code instructions

@AGENTS.md

`AGENTS.md` is the canonical source of operational rules. Maintain durable development decisions and verification logs in tracked repo files, not chat history. Do not add model/vendor attribution or co-author trailers to commits.
```

If another agent harness supports its own instruction file, make it reference the same `AGENTS.md`; avoid contradictory copies. Use uppercase canonical filenames; do not create only lowercase `agents.md` or `claude.md`.

## 9. Decisions requiring engineering judgment, not renewed product discussion

The owner has already selected a name and architecture. Make limited, documented decisions autonomously about:

- HTTP library and SSE implementation, with privacy and Windows behavior checked;
- React Aria tree primitives versus accessible custom tree if virtualization constraints require it;
- SQLite implementation under Node 24 (its `node:sqlite` interface may require a compatibility decision), schema migrations and backup;
- exact polling intervals, cache limits and coalescing strategy after observing fixture performance;
- icons and component package versions, with license and bundle-size considerations;
- whether a particular provider status can be established directly or should remain `unknown`;
- whether native Windows folder picker is viable without extra packaging (path input is an acceptable fallback).

Record these in small ADRs and tests. Do not consume time on elaborate drag-and-drop docking, speculative plugins, external data stores, analytics, or supporting every alternative shell.

## 10. Nonfunctional objectives

Treat these as engineering targets to measure and report, **not** promises or arbitrary release blockers without evidence:

- Dashboard loads promptly for at least 10 repositories, 50 worktrees and 500 historical sessions on an ordinary Windows desktop; avoid blocking the browser on full transcript scans.
- Git/status scans run with bounded concurrency; refresh is responsive without heavy process/network churn.
- No lost annotations across ordinary restarts, refreshes or provider log rotation.
- Graceful behavior with missing Git, no installed Claude, no installed Codex, offline GitHub, absent remote, and permission-denied folders.
- Diagnostic logging excludes transcript excerpts, tokens, secrets and unredacted shell output.
- Accessible color contrast, visible keyboard focus, full tree keyboard operation, reduced-motion support, scalable UI density, and reliable theme persistence.

## 11. Final delivery checklist for implementing agent

- [ ] User can follow README Windows installation and one-command start.
- [ ] Browser UI is served by a real localhost backend, not a static demo.
- [ ] Multiple repos can be registered/unregistered safely; no source files deleted.
- [ ] Local refs, upstream refs, remote-only refs, worktrees, detached heads and Git status are represented correctly.
- [ ] Multiple independent Claude/Codex sessions in one worktree are correctly discovered and displayed (supported versions/fixtures documented).
- [ ] Status UI distinguishes evidence, uncertainty, stale and errors; does not claim unobserved approvals.
- [ ] Watch/poll reconciliation updates without manual refresh and recovers from missed events.
- [ ] Human tags/notes/review/checklists persist and all-checked checklists visually collapse without data loss.
- [ ] PR feature, if enabled, is read-only and optional; no network is needed for core behavior.
- [ ] Local privacy controls, API authentication, Origin/Host/CSRF defenses and safe path handling are tested.
- [ ] Tests, Windows CI, docs strict build and MkDocs Pages workflow are working.
- [ ] `AGENTS.md`, `CLAUDE.md`, README, SECURITY, architecture, user docs, ADRs and handoff status are current.
- [ ] No credentials, real provider transcripts, generated databases, or confidential worktree data are committed.
- [ ] Report precisely what was built, what was tested live vs synthetically, remaining gaps and exact startup commands.

---

**Guiding product principle:** repobs is a **Git-first observatory with human-owned task state**. It watches existing work; it does not become the work's owner. Fidelity of observation, clarity of uncertainty, Windows reliability and low-friction use matter more than adding orchestration features.
