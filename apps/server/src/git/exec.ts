import { runProcess, SpawnError, type RunResult } from '../platform/process.ts'

// The read-only Git boundary. Every Git invocation in repobs goes through runGit(), which accepts
// only the inspection commands below. Anything else (fetch, checkout, commit, worktree add, ...)
// throws before a process is spawned. tests/git/exec.test.ts pins this allowlist.

export const REF_FORMAT =
  '%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)%00%(worktreepath)%00%(symref)%00'

type ArgRule = (args: readonly string[]) => boolean

const exactly =
  (...expected: string[]): ArgRule =>
  (args) =>
    args.length === expected.length && args.every((a, i) => a === expected[i])

const REV_PARSE_FLAGS = new Set([
  '--show-toplevel',
  '--git-common-dir',
  '--absolute-git-dir',
  '--path-format=absolute',
  '--is-bare-repository',
  '--is-inside-work-tree',
])

const STATUS_FLAGS = new Set([
  '--porcelain=v2',
  '--branch',
  '-z',
  '--untracked-files=normal',
  '--untracked-files=all',
  '--untracked-files=no',
  '--ignore-submodules=dirty',
  '--ignore-submodules=all',
  '--no-renames',
  '--find-renames',
])

/** Subcommand -> argument rule. Keep this list short; additions need a product decision. */
export const GIT_ALLOWLIST: Record<string, ArgRule> = {
  '--version': (args) => args.length === 0,
  'rev-parse': (args) => args.length > 0 && args.every((a) => REV_PARSE_FLAGS.has(a)),
  worktree: exactly('list', '--porcelain', '-z'),
  status: (args) => args.includes('--porcelain=v2') && args.every((a) => STATUS_FLAGS.has(a)),
  'for-each-ref': exactly(`--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes'),
  remote: exactly('-v'),
}

export class GitError extends Error {
  readonly code: string
  readonly stderr: string
  constructor(code: string, message: string, stderr = '') {
    super(message)
    this.code = code
    this.stderr = stderr
  }
}

export function assertAllowedGitArgs(args: readonly string[]): void {
  const [sub, ...rest] = args
  if (!sub) throw new GitError('git_not_allowed', 'Empty git command')
  const rule = Object.hasOwn(GIT_ALLOWLIST, sub) ? GIT_ALLOWLIST[sub] : undefined
  if (!rule || !rule(rest)) {
    throw new GitError('git_not_allowed', `git ${sub} with these arguments is not an allowed read-only inspection`)
  }
}

/** Environment that keeps Git non-interactive, pager-free and lock-free. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GCM_INTERACTIVE: 'never',
    GIT_EDITOR: ':',
    LC_ALL: 'C',
  }
}

export interface GitRunner {
  (cwd: string, args: readonly string[], opts?: { timeoutMs?: number; maxOutputBytes?: number }): Promise<Buffer>
}

export interface GitRunnerOptions {
  executable?: string
  /** Observes every argv actually spawned (used by the read-only verification tests). */
  onSpawn?: (argv: readonly string[]) => void
}

export function createGitRunner(options: GitRunnerOptions = {}): GitRunner {
  const executable = options.executable ?? 'git'
  return async (cwd, args, opts = {}) => {
    assertAllowedGitArgs(args)
    if (cwd.startsWith('-') || cwd.includes('\0')) throw new GitError('invalid_path', 'Invalid repository path')
    // core.fsmonitor=false: a repository's config could otherwise make `git status` run a hook program.
    const argv = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-C', cwd, ...args]
    options.onSpawn?.(argv)
    let result: RunResult
    try {
      result = await runProcess(executable, argv, {
        timeoutMs: opts.timeoutMs ?? 20_000,
        maxOutputBytes: opts.maxOutputBytes ?? 16 * 1024 * 1024,
        env: gitEnv(),
      })
    } catch (err) {
      if (err instanceof SpawnError && err.code === 'not_found') {
        throw new GitError('git_not_found', 'Git is not installed or not on PATH')
      }
      throw new GitError('git_spawn_failed', (err as Error).message)
    }
    if (result.timedOut) throw new GitError('git_timeout', `git ${args[0]} timed out`)
    if (result.truncated) throw new GitError('git_output_too_large', `git ${args[0]} output exceeded the limit`)
    if (result.code !== 0) throw classifyGitFailure(result.stderr, args[0] ?? '')
    return result.stdout
  }
}

function classifyGitFailure(stderr: string, sub: string): GitError {
  const s = stderr.toLowerCase()
  if (s.includes('not a git repository')) return new GitError('not_a_repository', 'Not a Git repository', stderr)
  if (s.includes('dubious ownership'))
    return new GitError(
      'dubious_ownership',
      'Git refuses this repository because of its ownership (safe.directory). repobs does not change Git configuration.',
      stderr,
    )
  if (s.includes('permission denied')) return new GitError('permission_denied', 'Permission denied', stderr)
  if (s.includes('cannot change to') || s.includes('no such file'))
    return new GitError('path_missing', 'The path does not exist', stderr)
  if (s.includes('must be run in a work tree') || s.includes('this operation must be run in a work tree'))
    return new GitError('bare_repository', 'Bare repository has no working tree', stderr)
  return new GitError('git_failed', `git ${sub} failed`, stderr)
}
