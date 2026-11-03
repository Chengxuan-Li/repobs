import type { ToolCategory } from '@repobs/contracts'

// Tool categories and allowlisted command verbs (ADR 0013). A command string is split and matched
// in memory only; the result holds a category and, when every word of it is on an allowlist, a
// short verb such as `git commit` or `npm test`. Arguments, paths and unknown programs never leave.

export interface ToolClass {
  category: ToolCategory
  /** The tool's name as shown: the provider's name, MCP tools as `mcp:<server>`. */
  tool: string
  verb?: string
}

const CLAUDE_TOOLS: Record<string, ToolCategory> = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  ToolSearch: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  TaskOutput: 'shell',
  TaskStop: 'shell',
  Monitor: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agents',
  Task: 'agents',
  SendMessage: 'agents',
  ListAgents: 'agents',
  SubagentHandback: 'agents',
  TodoWrite: 'plan',
  TaskCreate: 'plan',
  TaskUpdate: 'plan',
  AskUserQuestion: 'ask',
  ExitPlanMode: 'ask',
}

const CODEX_TOOLS: Record<string, ToolCategory> = {
  exec: 'shell',
  exec_command: 'shell',
  shell: 'shell',
  local_shell: 'shell',
  container_exec: 'shell',
  write_stdin: 'shell',
  apply_patch: 'edit',
  view_image: 'read',
  web_search: 'web',
  spawn_agent: 'agents',
  send_message: 'agents',
  wait_agent: 'agents',
  list_agents: 'agents',
  followup_task: 'agents',
  wait: 'agents',
  update_plan: 'plan',
  request_user_input: 'ask',
  request_user_input_async: 'ask',
}

/** Plan tools of the Claude desktop app, served over MCP. */
const PLAN_MCP = new Set(['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up'])

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'exec', 'exec_command', 'shell', 'local_shell', 'container_exec'])

export function classifyTool(provider: 'claude' | 'codex', name: string, command?: string): ToolClass {
  if (PLAN_MCP.has(name)) return { category: 'plan', tool: name.slice('mcp__ccd_turn__'.length) }
  const mcp = /^mcp__(.+?)__[^_].*$/.exec(name)
  if (mcp) return { category: 'mcp', tool: `mcp:${mcp[1]!.slice(0, 60)}` }
  const table = provider === 'claude' ? CLAUDE_TOOLS : CODEX_TOOLS
  const category = table[name] ?? 'other'
  const tool = name.slice(0, 80)
  if (SHELL_TOOLS.has(name) && command) {
    const c = classifyCommand(command)
    return { category: c.category, tool, ...(c.verb ? { verb: c.verb } : {}) }
  }
  return { category, tool }
}

// --- Shell commands --------------------------------------------------------------------------

const GIT_INSPECT = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'blame', 'describe', 'grep', 'merge-base',
  'cat-file', 'for-each-ref', 'shortlog', 'reflog', 'remote', 'config', 'branch', 'worktree', 'tag', 'stash', 'show-ref', 'name-rev', 'help', 'version',
])
const GIT_CHANGE = new Set([
  'add', 'commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'restore', 'cherry-pick', 'revert', 'rm', 'mv',
  'clean', 'am', 'apply', 'init', 'clone', 'gc', 'prune', 'update-ref', 'symbolic-ref', 'filter-branch', 'notes', 'submodule',
])
/** Subcommands that inspect by default but change with these flags or sub-subcommands. */
const GIT_CHANGING_FORMS: Record<string, RegExp> = {
  branch: /^(-d|-D|--delete|-m|-M|--move|-c|-C|--copy|-f|--force|--set-upstream-to|-u)$/,
  worktree: /^(add|remove|move|prune|lock|unlock|repair)$/,
  tag: /^(-d|--delete|-a|-s|-f)$/,
  stash: /^(push|pop|apply|drop|clear|save|store)$/,
  remote: /^(add|remove|rm|rename|set-url|set-head|prune)$/,
  config: /^(--unset|--add|--replace-all|--unset-all|--remove-section|--rename-section)$/,
}

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const PM_SUBCOMMANDS = new Set(['install', 'i', 'ci', 'add', 'remove', 'uninstall', 'update', 'test', 't', 'run', 'exec', 'build', 'start', 'publish', 'pack', 'audit', 'outdated', 'ls', 'list', 'init', 'version', 'dlx', 'x'])
const PM_SCRIPTS = new Set(['build', 'test', 'lint', 'typecheck', 'check', 'dev', 'start', 'format', 'fmt', 'preview', 'e2e', 'clean', 'docs:build', 'docs:api', 'test:integration', 'test:e2e', 'test:unit', 'serve', 'watch'])
const TEST_BUILD_SCRIPTS = /^(build|test|lint|typecheck|check|e2e|docs:build|test:.*|ci)$/
const NPX_TOOLS = new Set(['vitest', 'jest', 'playwright', 'tsc', 'eslint', 'prettier', 'vite', 'tsx', 'mocha', 'biome', 'mkdocs', 'turbo', 'nx', 'cypress'])
const NPX_TEST_BUILD = new Set(['vitest', 'jest', 'playwright', 'tsc', 'eslint', 'mocha', 'biome', 'cypress', 'turbo', 'nx'])

/** Programs reported by name; anything else is a plain shell call without a verb. */
const PROGRAMS = new Set([
  'node', 'python', 'python3', 'py', 'pip', 'pip3', 'uv', 'poetry', 'deno', 'tsc', 'gh', 'curl', 'wget', 'docker', 'kubectl', 'make', 'cmake',
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'find', 'sed', 'awk', 'wc', 'sort', 'echo', 'printf', 'mkdir', 'rm', 'cp', 'mv',
  'touch', 'chmod', 'diff', 'jq', 'tar', 'unzip', 'zip', 'ps', 'kill', 'which', 'where', 'env', 'set', 'pwd', 'date', 'tree', 'du', 'df',
  'Get-ChildItem', 'Get-Content', 'Set-Content', 'Select-String', 'Get-Process', 'Stop-Process', 'Remove-Item', 'Copy-Item', 'Move-Item',
  'New-Item', 'Test-Path', 'Invoke-WebRequest', 'Get-NetTCPConnection', 'Start-Process', 'Write-Output', 'Get-Item', 'Measure-Object',
  'netstat', 'tasklist', 'taskkill', 'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'code', 'explorer', 'start', 'mkdocs', 'cargo', 'go',
  'dotnet', 'pytest', 'ruff', 'black', 'mypy', 'tox', 'java', 'mvn', 'gradle', 'sqlite3', 'zstd',
])
/** Skipped when they lead a segment: they set up rather than do the work. */
const PREFIXES = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'sleep', 'time', 'sudo', 'env', 'nohup', 'timeout', 'Set-Location', 'true', ':'])

const RANK: Record<string, number> = { git_write: 4, test_build: 3, git_read: 2, shell: 1 }
/** Among Git changes in one command, the verb shown is the most consequential. */
const GIT_WEIGHT: Record<string, number> = { 'git push': 3, 'git commit': 2, 'git merge': 1, 'git rebase': 1, 'git reset': 1 }

export function classifyCommand(command: string): { category: ToolCategory; verb?: string } {
  let best: { category: ToolCategory; verb?: string } = { category: 'shell' }
  // Only the first few lines matter for a summary; long scripts stay bounded.
  const text = command.slice(0, 4_000)
  for (const segment of text.split(/&&|\|\||[;|\n]/)) {
    const c = classifySegment(segment)
    if (!c) continue
    const rank = RANK[c.category]!
    const bestRank = RANK[best.category]!
    const heavier = (GIT_WEIGHT[c.verb ?? ''] ?? 0) > (GIT_WEIGHT[best.verb ?? ''] ?? 0)
    if (rank > bestRank || (rank === bestRank && ((!best.verb && c.verb) || heavier))) best = c
  }
  return best
}

function words(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^["'(]+|["')]+$/g, ''))
}

function classifySegment(segment: string): { category: ToolCategory; verb?: string } | undefined {
  let w = words(segment)
  // Drop leading environment assignments (`FOO=1 cmd`, `$env:X = 'y'`) and setup words.
  while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!) || PREFIXES.has(w[0]!))) {
    const lead = w[0]!
    w = w.slice(1)
    if (lead === 'cd' || lead === 'Set-Location' || lead === 'pushd') w = w.slice(1)
    if (lead === 'timeout' && w.length && /^\d/.test(w[0]!)) w = w.slice(1)
  }
  if (!w.length || w[0]!.startsWith('$')) return undefined
  const program = programName(w[0]!)
  const rest = w.slice(1)
  if (program === 'git') return classifyGit(rest)
  if (PACKAGE_MANAGERS.has(program)) return classifyPackageManager(program, rest)
  if (program === 'npx' || program === 'pnpx' || program === 'bunx') {
    const tool = rest.find((x) => !x.startsWith('-'))
    if (tool && NPX_TOOLS.has(tool)) return { category: NPX_TEST_BUILD.has(tool) ? 'test_build' : 'shell', verb: `${program} ${tool}` }
    return { category: 'shell', verb: program }
  }
  if (program === 'pytest' || program === 'tox' || program === 'mypy' || program === 'ruff' || program === 'tsc') return { category: 'test_build', verb: program }
  if ((program === 'python' || program === 'python3' || program === 'py') && rest[0] === '-m' && rest[1] && /^(pytest|unittest|mypy|ruff|black|build|pip|mkdocs)$/.test(rest[1])) {
    return { category: /^(pytest|unittest|mypy|ruff|build)$/.test(rest[1]) ? 'test_build' : 'shell', verb: `${program} -m ${rest[1]}` }
  }
  if ((program === 'cargo' || program === 'go' || program === 'dotnet') && rest[0] && /^(build|test|check|clippy|run|vet|fmt)$/.test(rest[0])) {
    return { category: /^(build|test|check|clippy|vet)$/.test(rest[0]) ? 'test_build' : 'shell', verb: `${program} ${rest[0]}` }
  }
  if (program === 'make' || program === 'cmake' || program === 'mvn' || program === 'gradle') return { category: 'test_build', verb: program }
  if (program === 'mkdocs' && rest[0] && /^(build|serve)$/.test(rest[0])) return { category: rest[0] === 'build' ? 'test_build' : 'shell', verb: `mkdocs ${rest[0]}` }
  if (program === 'gh' && rest[0] && /^(pr|issue|run|api|repo|release|auth|workflow)$/.test(rest[0])) return { category: 'shell', verb: `gh ${rest[0]}` }
  if (PROGRAMS.has(program)) return { category: 'shell', verb: program }
  return { category: 'shell' }
}

/** `C:\x\git.exe` and `./node_modules/.bin/vitest` → `git`, `vitest`. */
function programName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '')
}

function classifyGit(rest: string[]): { category: ToolCategory; verb?: string } {
  // Skip global options (`-C dir`, `-c k=v`, `--no-pager`).
  let i = 0
  while (i < rest.length && rest[i]!.startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1
  const sub = rest[i]
  if (!sub) return { category: 'git_read', verb: 'git' }
  const args = rest.slice(i + 1)
  if (GIT_CHANGE.has(sub)) return { category: 'git_write', verb: `git ${sub}` }
  const changing = GIT_CHANGING_FORMS[sub]
  if (changing && args.some((a) => changing.test(a))) return { category: 'git_write', verb: `git ${sub}` }
  if (GIT_INSPECT.has(sub)) return { category: 'git_read', verb: `git ${sub}` }
  return { category: 'git_read', verb: 'git' }
}

function classifyPackageManager(pm: string, rest: string[]): { category: ToolCategory; verb?: string } {
  const sub = rest.find((x) => !x.startsWith('-'))
  if (!sub) return { category: 'shell', verb: pm }
  if (sub === 'run' || sub === 'run-script') {
    const script = rest[rest.indexOf(sub) + 1]
    if (script && PM_SCRIPTS.has(script)) return { category: TEST_BUILD_SCRIPTS.test(script) ? 'test_build' : 'shell', verb: `${pm} run ${script}` }
    return { category: 'shell', verb: `${pm} run` }
  }
  if (sub === 'test' || sub === 't' || sub === 'build') return { category: 'test_build', verb: `${pm} ${sub === 't' ? 'test' : sub}` }
  if (PM_SUBCOMMANDS.has(sub)) return { category: 'shell', verb: `${pm} ${sub}` }
  // `yarn build`, `pnpm lint`: a script name used directly.
  if (pm !== 'npm' && PM_SCRIPTS.has(sub)) return { category: TEST_BUILD_SCRIPTS.test(sub) ? 'test_build' : 'shell', verb: `${pm} ${sub}` }
  return { category: 'shell', verb: pm }
}
