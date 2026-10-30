import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Builds disposable, synthetic Git repositories for tests and demos. This module is the only place
// that runs mutating Git commands, and only inside the directory it is given (never a real repo).

const FIXTURE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'repobs fixture',
  GIT_AUTHOR_EMAIL: 'fixture@repobs.invalid',
  GIT_COMMITTER_NAME: 'repobs fixture',
  GIT_COMMITTER_EMAIL: 'fixture@repobs.invalid',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
}

const BASE_CONFIG = [
  '-c', 'init.defaultBranch=main',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.autocrlf=false',
  '-c', 'advice.detachedHead=false',
  '-c', 'protocol.file.allow=always',
  '-c', 'core.longpaths=true',
]

export function fixtureGit(cwd: string, args: string[], allowFailure = false): string {
  const r = spawnSync('git', [...BASE_CONFIG, ...args], { cwd, env: FIXTURE_ENV, encoding: 'utf8', shell: false })
  if (r.status !== 0 && !allowFailure) {
    throw new Error(`fixture git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`)
  }
  return r.stdout
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

export interface GitFixture {
  root: string
  origin: string
  repoA: string
  repoB: string
  worktrees: {
    feature: string
    detached: string
    unicode: string
    conflict: string
    rebase: string
    removed: string
  }
}

/**
 * Two unrelated repositories. Repo A has: main tracking origin/main, feature/tracked (tracking,
 * checked out in a linked worktree), claude/scratch-a8de (local-only), gone-branch (upstream
 * removed), origin/remote-only (remote-only), a detached worktree, a worktree whose path has spaces
 * and Unicode, a merge conflict, a rebase stopped on a conflict, and a removed worktree directory.
 */
export function buildGitFixture(root: string): GitFixture {
  fs.mkdirSync(root, { recursive: true })
  const origin = path.join(root, 'origin.git')
  const repoA = path.join(root, 'repo-a')
  const repoB = path.join(root, 'repo-b')
  const other = path.join(root, 'other-clone')
  const wtRoot = path.join(root, 'repo-a-worktrees')
  const worktrees = {
    feature: path.join(wtRoot, 'feature'),
    detached: path.join(wtRoot, 'detached'),
    unicode: path.join(wtRoot, 'wt ü space'),
    conflict: path.join(wtRoot, 'conflict'),
    rebase: path.join(wtRoot, 'rebase'),
    removed: path.join(wtRoot, 'removed'),
  }

  fixtureGit(root, ['init', '--bare', origin])
  fixtureGit(root, ['init', repoA])
  write(path.join(repoA, 'README.md'), '# repo a\n')
  write(path.join(repoA, 'shared.txt'), 'line one\n')
  fixtureGit(repoA, ['add', '.'])
  fixtureGit(repoA, ['commit', '-m', 'initial'])
  fixtureGit(repoA, ['remote', 'add', 'origin', origin])
  fixtureGit(repoA, ['push', '-u', 'origin', 'main'])

  fixtureGit(repoA, ['branch', 'feature/tracked'])
  fixtureGit(repoA, ['push', '-u', 'origin', 'feature/tracked'])
  fixtureGit(repoA, ['branch', 'gone-branch'])
  fixtureGit(repoA, ['push', '-u', 'origin', 'gone-branch'])
  fixtureGit(repoA, ['push', 'origin', '--delete', 'gone-branch'])
  fixtureGit(repoA, ['fetch', '--prune', 'origin'])

  // A branch that exists only on the remote: pushed from another clone, then fetched.
  fixtureGit(root, ['clone', origin, other])
  fixtureGit(other, ['checkout', '-b', 'remote-only'])
  write(path.join(other, 'remote.txt'), 'remote\n')
  fixtureGit(other, ['add', '.'])
  fixtureGit(other, ['commit', '-m', 'remote only work'])
  fixtureGit(other, ['push', 'origin', 'remote-only'])
  fixtureGit(repoA, ['fetch', 'origin'])

  fixtureGit(repoA, ['branch', 'claude/scratch-a8de'])
  fixtureGit(repoA, ['worktree', 'add', worktrees.feature, 'feature/tracked'])
  fixtureGit(repoA, ['worktree', 'add', '--detach', worktrees.detached, 'HEAD'])
  fixtureGit(repoA, ['worktree', 'add', '-b', 'unicode-branch', worktrees.unicode])

  // Ahead of upstream: a local commit on feature/tracked.
  write(path.join(worktrees.feature, 'feature.txt'), 'feature\n')
  fixtureGit(worktrees.feature, ['add', '.'])
  fixtureGit(worktrees.feature, ['commit', '-m', 'feature work'])

  // Merge conflict in progress.
  fixtureGit(repoA, ['branch', 'conflict-base'])
  fixtureGit(repoA, ['worktree', 'add', '-b', 'conflict-work', worktrees.conflict])
  write(path.join(worktrees.conflict, 'shared.txt'), 'conflict side\n')
  fixtureGit(worktrees.conflict, ['commit', '-am', 'conflict side'])
  fixtureGit(repoA, ['checkout', 'conflict-base'])
  write(path.join(repoA, 'shared.txt'), 'base side\n')
  fixtureGit(repoA, ['commit', '-am', 'base side'])
  fixtureGit(repoA, ['checkout', 'main'])
  fixtureGit(worktrees.conflict, ['merge', 'conflict-base'], true)

  // Rebase stopped on a conflict.
  fixtureGit(repoA, ['worktree', 'add', '-b', 'rebase-work', worktrees.rebase])
  write(path.join(worktrees.rebase, 'shared.txt'), 'rebase side\n')
  fixtureGit(worktrees.rebase, ['commit', '-am', 'rebase side'])
  fixtureGit(worktrees.rebase, ['rebase', 'conflict-base'], true)

  // A worktree whose directory was deleted outside Git (prunable).
  fixtureGit(repoA, ['worktree', 'add', '-b', 'removed-work', worktrees.removed])
  fs.rmSync(worktrees.removed, { recursive: true, force: true })

  // Primary worktree: staged, unstaged and untracked changes (filenames with spaces/Unicode).
  write(path.join(repoA, 'staged file.txt'), 'staged\n')
  fixtureGit(repoA, ['add', 'staged file.txt'])
  write(path.join(repoA, 'README.md'), '# repo a (edited)\n')
  write(path.join(repoA, 'notes ü.txt'), 'untracked\n')

  // Repo B: an unrelated, clean repository with a local-only branch.
  fixtureGit(root, ['init', repoB])
  write(path.join(repoB, 'b.txt'), 'b\n')
  fixtureGit(repoB, ['add', '.'])
  fixtureGit(repoB, ['commit', '-m', 'b initial'])
  fixtureGit(repoB, ['branch', 'codex/experiment-1'])

  return { root, origin, repoA, repoB, worktrees }
}

/** Hash of every file under a Git directory (contents + paths), to prove repobs never writes to it. */
export function snapshotTree(dir: string): Map<string, string> {
  const result = new Map<string, string>()
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile()) {
        const st = fs.statSync(p)
        result.set(path.relative(dir, p), `${st.size}:${st.mtimeMs}:${fs.readFileSync(p).toString('base64').slice(0, 2048)}`)
      }
    }
  }
  walk(dir)
  return result
}
