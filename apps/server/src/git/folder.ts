import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Worktree } from '@repobs/contracts'
import { basenameOf, canonicalPath, isAbsoluteLocalPath, isWithin, pathKey } from '../platform/paths.ts'
import { GitError, type GitRunner } from './exec.ts'
import { emptyStatus } from './reader.ts'

// Folders without Git (ADR 0011). A registered folder is never read beyond "does it exist and is
// it a directory"; the only Git call asks, read-only, whether a repository now covers it.

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

export const folderIdFor = (folderPath: string) => 'folder_' + hash(pathKey(folderPath)).slice(0, 12)
/** Distinct from a Git worktree at the same path, which may be registered too. */
const folderWorktreeIdFor = (folderPath: string) => 'wt_' + hash('folder|' + pathKey(folderPath)).slice(0, 16)

const REV_PARSE = ['rev-parse', '--path-format=absolute', '--git-common-dir', '--is-bare-repository'] as const

/** Whether Git reports the folder as inside a repository: true, false, or undefined when Git cannot tell. */
export async function folderInRepository(git: GitRunner, folder: string): Promise<boolean | undefined> {
  try {
    await git(folder, REV_PARSE)
    return true
  } catch (err) {
    if (!(err instanceof GitError)) return undefined
    // Git refuses a repository it does not trust: still a repository.
    if (err.code === 'dubious_ownership') return true
    // Without Git nothing can be a repository for repobs.
    if (err.code === 'not_a_repository' || err.code === 'git_not_found') return false
    return undefined
  }
}

function isRoot(display: string): boolean {
  const p = process.platform === 'win32' ? path.win32 : path.posix
  return p.dirname(display) === display || pathKey(p.parse(display).root) === pathKey(display)
}

/** The file-system checks for a folder registration (no Git call). Returns the canonical display path. */
export function checkFolderPath(input: string, home = os.homedir()): string {
  if (!isAbsoluteLocalPath(input)) throw new GitError('invalid_path', 'Enter an absolute local path such as C:\\work\\notes')
  const display = canonicalPath(input)
  let stat: fs.Stats
  try {
    stat = fs.statSync(display)
  } catch {
    throw new GitError('path_missing', 'The path does not exist')
  }
  if (!stat.isDirectory()) throw new GitError('not_a_directory', 'The path is not a directory')
  if (isRoot(display)) throw new GitError('folder_too_broad', 'A drive or file-system root cannot be added as a folder')
  if (home && isWithin(canonicalPath(home), display)) {
    throw new GitError('folder_too_broad', 'Your home folder, or a folder containing it, cannot be added: it would collect almost every session')
  }
  return display
}

/** Validate a user-supplied folder path for registration (read-only). Returns its canonical display path. */
export async function resolveFolder(git: GitRunner, input: string, home = os.homedir()): Promise<string> {
  const display = checkFolderPath(input, home)
  const inRepo = await folderInRepository(git, display)
  if (inRepo === true) throw new GitError('inside_repository', 'This folder is inside a Git repository; add it as a repository instead')
  // Git timed out or failed for another reason: we cannot tell, so do not claim it is a plain folder.
  if (inRepo === undefined) throw new GitError('git_failed', 'Git could not check whether this folder is inside a repository')
  return display
}

/** The single stand-in worktree that lets session matching treat a folder like a checkout. */
export function folderWorktree(repo: { id: string; primaryPath: string }, previous?: Worktree): Worktree {
  const missing = !fs.existsSync(repo.primaryPath)
  return {
    id: folderWorktreeIdFor(repo.primaryPath),
    repoId: repo.id,
    path: repo.primaryPath,
    displayName: basenameOf(repo.primaryPath),
    isPrimary: true,
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    missing,
    status: missing ? emptyStatus('unavailable', { code: 'folder_missing', message: 'The folder no longer exists' }) : emptyStatus('unavailable'),
    lastStatusAt: missing ? undefined : previous?.lastStatusAt,
  }
}
