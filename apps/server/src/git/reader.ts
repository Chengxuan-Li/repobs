import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BranchRef, ErrorInfo, GitOperation, Worktree, WorktreeStatus } from '@repobs/contracts'
import { basenameOf, canonicalPath, isAbsoluteLocalPath, pathKey, toDisplayPath } from '../platform/paths.ts'
import { GitError, type GitRunner, REF_FORMAT } from './exec.ts'
import { parseRefs, parseStatusV2, parseTrack, parseWorktreeList, type RawWorktree } from './parse.ts'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

export const repositoryIdFor = (commonGitDir: string) => 'repo_' + hash(pathKey(commonGitDir)).slice(0, 12)
export const worktreeIdFor = (worktreePath: string) => 'wt_' + hash(pathKey(worktreePath)).slice(0, 16)
export const branchIdFor = (repoId: string, fullRef: string) => `${repoId}|${fullRef}`

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof GitError) return { code: err.code, message: err.message }
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return { code: 'permission_denied', message: 'Permission denied' }
  return { code: 'internal_error', message: 'Unexpected error while reading Git data' }
}

export interface ResolvedRepository {
  commonGitDir: string
  primaryPath: string
  isBare: boolean
}

/** Validate a user-supplied path and resolve the repository it belongs to (read-only). */
export async function resolveRepository(git: GitRunner, input: string): Promise<ResolvedRepository> {
  if (!isAbsoluteLocalPath(input)) {
    throw new GitError('invalid_path', 'Enter an absolute local path such as C:\\src\\project')
  }
  const display = canonicalPath(input)
  let stat: fs.Stats
  try {
    stat = fs.statSync(display)
  } catch {
    throw new GitError('path_missing', 'The path does not exist')
  }
  if (!stat.isDirectory()) throw new GitError('not_a_directory', 'The path is not a directory')

  const out = (await git(display, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--is-bare-repository']))
    .toString('utf8')
    .split(/\r?\n/)
  const commonGitDir = canonicalPath(out[0] ?? '')
  const isBare = out[1]?.trim() === 'true'
  if (!commonGitDir) throw new GitError('not_a_repository', 'Not a Git repository')
  if (isBare) return { commonGitDir, primaryPath: commonGitDir, isBare }

  // The primary worktree is the first entry of `worktree list`, even when a linked worktree was registered.
  const worktrees = parseWorktreeList(await git(display, ['worktree', 'list', '--porcelain', '-z']))
  const first = worktrees[0]
  const primaryPath = first && !first.bare ? canonicalPath(first.path) : canonicalPath(display)
  return { commonGitDir, primaryPath, isBare: !!first?.bare }
}

export interface RepositoryScan {
  worktrees: Worktree[]
  branches: BranchRef[]
}

export interface RepoIdentity {
  id: string
  primaryPath: string
  commonGitDir: string
  isBare: boolean
}

/** List worktrees and refs. Working-tree status is filled by scanWorktreeStatus(). */
export async function scanRepository(
  git: GitRunner,
  repo: RepoIdentity,
  previous?: Map<string, Worktree>,
): Promise<RepositoryScan> {
  const cwd = repo.isBare ? repo.commonGitDir : repo.primaryPath
  const runDir = fs.existsSync(cwd) ? cwd : repo.commonGitDir
  const [wtOut, refOut] = await Promise.all([
    git(runDir, ['worktree', 'list', '--porcelain', '-z']),
    git(runDir, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes']),
  ])
  const rawWorktrees = parseWorktreeList(wtOut).filter((w) => !w.bare)
  const worktrees = rawWorktrees.map((raw, index) => toWorktree(repo, raw, index === 0 && !repo.isBare, previous))
  const branches = buildBranches(repo.id, parseRefs(refOut), worktrees)
  return { worktrees, branches }
}

function toWorktree(repo: RepoIdentity, raw: RawWorktree, isPrimary: boolean, previous?: Map<string, Worktree>): Worktree {
  const display = toDisplayPath(raw.path)
  const id = worktreeIdFor(display)
  const missing = !fs.existsSync(display)
  const prior = previous?.get(id)
  const head = raw.head && !/^0+$/.test(raw.head) ? raw.head : undefined
  return {
    id,
    repoId: repo.id,
    path: display,
    displayName: basenameOf(display),
    isPrimary,
    bare: false,
    headOid: head,
    branchFullRef: raw.branch,
    detached: raw.detached,
    locked: raw.locked,
    lockReason: raw.lockReason,
    prunable: raw.prunable,
    prunableReason: raw.prunableReason,
    missing,
    status: missing
      ? emptyStatus('unavailable', { code: 'worktree_missing', message: 'The worktree directory no longer exists' })
      : (prior?.status ?? emptyStatus('pending')),
    lastStatusAt: missing ? undefined : prior?.lastStatusAt,
  }
}

export function emptyStatus(state: WorktreeStatus['state'], error?: ErrorInfo): WorktreeStatus {
  return { state, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...(error ? { error } : {}) }
}

function buildBranches(repoId: string, refs: ReturnType<typeof parseRefs>, worktrees: Worktree[]): BranchRef[] {
  const byRef = new Map<string, BranchRef>()
  const worktreesByRef = new Map<string, string[]>()
  for (const wt of worktrees) {
    if (!wt.branchFullRef) continue
    const list = worktreesByRef.get(wt.branchFullRef) ?? []
    list.push(wt.id)
    worktreesByRef.set(wt.branchFullRef, list)
  }
  for (const r of refs) {
    if (r.symref) continue // refs/remotes/origin/HEAD and similar aliases
    const isLocal = r.refname.startsWith('refs/heads/')
    const isRemote = r.refname.startsWith('refs/remotes/')
    if (!isLocal && !isRemote) continue
    const id = branchIdFor(repoId, r.refname)
    const shortName = isLocal ? r.refname.slice('refs/heads/'.length) : r.refname.slice('refs/remotes/'.length)
    const branch: BranchRef = {
      id,
      repoId,
      fullRef: r.refname,
      shortName,
      kind: isLocal ? 'local' : 'remote_tracking',
      remoteName: isRemote ? shortName.split('/')[0] : undefined,
      tipOid: r.objectname,
      unborn: false,
      classification: isLocal ? 'local_only' : 'remote_only',
      worktreeIds: isLocal ? (worktreesByRef.get(r.refname) ?? []) : [],
      trackedByIds: [],
    }
    if (isLocal && r.upstream) branch.upstream = { fullRef: r.upstream, ...parseTrack(r.track) }
    byRef.set(r.refname, branch)
  }
  // Checked-out branches without commits are absent from for-each-ref.
  for (const [ref, ids] of worktreesByRef) {
    if (byRef.has(ref) || !ref.startsWith('refs/heads/')) continue
    byRef.set(ref, {
      id: branchIdFor(repoId, ref),
      repoId,
      fullRef: ref,
      shortName: ref.slice('refs/heads/'.length),
      kind: 'local',
      tipOid: '',
      unborn: true,
      classification: 'checked_out',
      worktreeIds: ids,
      trackedByIds: [],
    })
  }
  for (const b of byRef.values()) {
    if (b.kind !== 'local') continue
    if (b.upstream) {
      const remote = byRef.get(b.upstream.fullRef)
      if (remote) remote.trackedByIds.push(b.id)
      else if (b.upstream.fullRef.startsWith('refs/remotes/')) b.upstream.gone = true
    }
    b.classification = b.worktreeIds.length > 0 ? 'checked_out' : b.upstream ? 'local_tracking' : 'local_only'
  }
  for (const b of byRef.values()) {
    if (b.kind === 'remote_tracking') b.classification = b.trackedByIds.length > 0 ? 'remote_tracking' : 'remote_only'
  }
  return [...byRef.values()].sort((a, b) => a.fullRef.localeCompare(b.fullRef))
}

/** Per-worktree administrative directory (where MERGE_HEAD, rebase-merge/ etc. live). */
export function worktreeGitDir(worktreePath: string): string | undefined {
  const dotGit = path.join(worktreePath, '.git')
  try {
    const st = fs.statSync(dotGit)
    if (st.isDirectory()) return dotGit
    if (st.isFile() && st.size < 4096) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))
      if (m) return path.resolve(worktreePath, m[1]!.trim())
    }
  } catch {
    // missing or unreadable
  }
  return undefined
}

export function detectGitOperation(gitDir: string | undefined): GitOperation | undefined {
  if (!gitDir) return undefined
  const has = (name: string) => fs.existsSync(path.join(gitDir, name))
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase'
  if (has('MERGE_HEAD')) return 'merge'
  if (has('CHERRY_PICK_HEAD')) return 'cherry_pick'
  if (has('REVERT_HEAD')) return 'revert'
  if (has('BISECT_LOG')) return 'bisect'
  return undefined
}

export async function scanWorktreeStatus(git: GitRunner, worktree: Worktree): Promise<WorktreeStatus> {
  if (!fs.existsSync(worktree.path)) {
    return emptyStatus('unavailable', { code: 'worktree_missing', message: 'The worktree directory no longer exists' })
  }
  try {
    const raw = parseStatusV2(
      await git(worktree.path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'], {
        timeoutMs: 30_000,
      }),
    )
    return {
      state: 'ok',
      staged: raw.staged,
      unstaged: raw.unstaged,
      untracked: raw.untracked,
      conflicted: raw.conflicted,
      ahead: raw.ahead,
      behind: raw.behind,
      gitOperation: detectGitOperation(worktreeGitDir(worktree.path)),
    }
  } catch (err) {
    return emptyStatus('error', toErrorInfo(err))
  }
}
