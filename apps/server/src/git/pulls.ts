import { z } from 'zod'
import type { PullRequest, PullRequestStatus } from '@repobs/contracts'
import { runProcess, SpawnError } from '../platform/process.ts'
import type { GitRunner } from './exec.ts'
import { parseRemotes } from './parse.ts'

// Optional, read-only pull request metadata via the GitHub CLI (`gh pr list`). Disabled by default;
// the monitor only calls this after the user enables it in Settings. Nothing is sent to the network
// while it is disabled. Results are remote metadata, never local commit edges.

export function parseGithubRemote(url: string): { owner: string; repo: string } | undefined {
  const m =
    /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url) ??
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) ??
    /^ssh:\/\/git@github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (!m) return undefined
  const valid = /^[A-Za-z0-9_.-]{1,100}$/
  if (!valid.test(m[1]!) || !valid.test(m[2]!)) return undefined
  return { owner: m[1]!, repo: m[2]! }
}

const GhPr = z.object({
  number: z.number().int(),
  title: z.string().max(1000),
  url: z.string().url().max(500),
  headRefName: z.string().max(500),
  baseRefName: z.string().max(500),
  state: z.string().max(40),
  isDraft: z.boolean().optional(),
  updatedAt: z.string().max(64).optional(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable().optional(),
})
const GhPrList = z.array(GhPr).max(1000)

export interface GhOptions {
  /** Executable and leading arguments; tests substitute a fake `gh`. */
  command?: string
  prefixArgs?: string[]
}

export async function fetchPullRequests(
  git: GitRunner,
  repo: { id: string; primaryPath: string; commonGitDir: string; isBare: boolean },
  gh: GhOptions = {},
): Promise<{ status: PullRequestStatus; pullRequests: PullRequest[] }> {
  const fetchedAt = new Date().toISOString()
  let remotes: Array<{ name: string; url: string }>
  try {
    remotes = parseRemotes(await git(repo.isBare ? repo.commonGitDir : repo.primaryPath, ['remote', '-v']))
  } catch {
    return { status: { repoId: repo.id, state: 'error', fetchedAt, error: { code: 'git_failed', message: 'Could not read remotes' } }, pullRequests: [] }
  }
  const ordered = [...remotes.filter((r) => r.name === 'origin'), ...remotes.filter((r) => r.name !== 'origin')]
  const gh_remote = ordered.map((r) => ({ remote: r, gh: parseGithubRemote(r.url) })).find((x) => x.gh)
  if (!gh_remote?.gh) return { status: { repoId: repo.id, state: 'no_github_remote', fetchedAt }, pullRequests: [] }
  const { owner, repo: name } = gh_remote.gh
  const args = [
    ...(gh.prefixArgs ?? []),
    'pr',
    'list',
    '--repo',
    `${owner}/${name}`,
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,url,headRefName,baseRefName,state,isDraft,updatedAt,headRepositoryOwner',
  ]
  const base: PullRequestStatus = { repoId: repo.id, state: 'ok', remote: `${owner}/${name}`, fetchedAt }
  try {
    const result = await runProcess(gh.command ?? 'gh', args, {
      timeoutMs: 30_000,
      maxOutputBytes: 4 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GH_PAGER: 'cat' },
    })
    if (result.timedOut) return { status: { ...base, state: 'error', error: { code: 'timeout', message: 'GitHub CLI timed out (offline?)' } }, pullRequests: [] }
    if (result.code !== 0) {
      const s = result.stderr.toLowerCase()
      const code = s.includes('auth') || s.includes('login') ? 'gh_not_authenticated' : s.includes('could not resolve') || s.includes('connect') ? 'offline' : 'gh_failed'
      const message =
        code === 'gh_not_authenticated'
          ? 'GitHub CLI is not authenticated (run `gh auth login` yourself if you want PR data)'
          : code === 'offline'
            ? 'GitHub is unreachable (offline?)'
            : 'GitHub CLI failed'
      return { status: { ...base, state: 'error', error: { code, message } }, pullRequests: [] }
    }
    const parsed = GhPrList.safeParse(JSON.parse(result.stdout.toString('utf8')))
    if (!parsed.success) return { status: { ...base, state: 'error', error: { code: 'gh_bad_output', message: 'Unexpected GitHub CLI output' } }, pullRequests: [] }
    const pullRequests: PullRequest[] = parsed.data
      // Fork PRs have head branches in another repository; never match them to local branches.
      .filter((p) => !p.headRepositoryOwner || p.headRepositoryOwner.login.toLowerCase() === owner.toLowerCase())
      .map((p) => ({
        id: `${repo.id}#${p.number}`,
        repoId: repo.id,
        number: p.number,
        title: p.title,
        url: p.url,
        headRef: p.headRefName,
        baseRef: p.baseRefName,
        state: p.state,
        isDraft: p.isDraft ?? false,
        updatedAt: p.updatedAt,
        fetchedAt,
      }))
    return { status: base, pullRequests }
  } catch (err) {
    const code = err instanceof SpawnError && err.code === 'not_found' ? 'gh_not_installed' : 'gh_failed'
    return {
      status: { ...base, state: 'error', error: { code, message: code === 'gh_not_installed' ? 'GitHub CLI (gh) is not installed' : 'GitHub CLI failed' } },
      pullRequests: [],
    }
  }
}
