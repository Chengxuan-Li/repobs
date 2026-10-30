import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureGit } from '../../fixtures/git-fixtures.ts'
import { createGitRunner } from '../../apps/server/src/git/exec.ts'
import { fetchPullRequests, parseGithubRemote } from '../../apps/server/src/git/pulls.ts'
import { resolveRepository, repositoryIdFor } from '../../apps/server/src/git/reader.ts'
import { startTestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

let root: string
let repo: string
let fakeGh: string
let ghLog: string

beforeAll(() => {
  root = makeTempDir('prs')
  repo = path.join(root, 'gh-repo')
  fixtureGit(root, ['init', repo])
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a')
  fixtureGit(repo, ['add', '.'])
  fixtureGit(repo, ['commit', '-m', 'init'])
  fixtureGit(repo, ['remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'])
  ghLog = path.join(root, 'gh-calls.log')
  // A fake GitHub CLI: records its argv and prints canned JSON (one same-repo PR, one fork PR).
  fakeGh = path.join(root, 'fake-gh.mjs')
  fs.writeFileSync(
    fakeGh,
    `import fs from 'node:fs'
fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(process.argv.slice(2)) + '\\n')
if (process.env.FAKE_GH_FAIL) { process.stderr.write('To get started with GitHub CLI, please run: gh auth login'); process.exit(4) }
process.stdout.write(JSON.stringify([
  { number: 42, title: 'Add parser', url: 'https://github.com/example-owner/example-repo/pull/42', headRefName: 'main', baseRefName: 'release', state: 'OPEN', isDraft: false, updatedAt: '2026-10-30T00:00:00Z', headRepositoryOwner: { login: 'example-owner' } },
  { number: 43, title: 'Fork PR', url: 'https://github.com/example-owner/example-repo/pull/43', headRefName: 'main', baseRefName: 'main', state: 'OPEN', isDraft: true, headRepositoryOwner: { login: 'someone-else' } }
]))
`,
  )
})
afterAll(() => removeDir(root))

describe('optional GitHub pull request metadata', () => {
  it('parses GitHub remotes and rejects lookalikes', () => {
    expect(parseGithubRemote('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubRemote('git@github.com:o/r.git')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubRemote('ssh://git@github.com/o/r')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubRemote('https://github.com.evil.example/o/r')).toBeUndefined()
    expect(parseGithubRemote('https://gitlab.com/o/r')).toBeUndefined()
    expect(parseGithubRemote('https://github.com/o/r;rm -rf/')).toBeUndefined()
  })

  it('lists open PRs read-only via argv, excluding fork heads', async () => {
    const git = createGitRunner()
    const r = await resolveRepository(git, repo)
    const result = await fetchPullRequests(git, { id: repositoryIdFor(r.commonGitDir), ...r }, { command: process.execPath, prefixArgs: [fakeGh] })
    expect(result.status).toMatchObject({ state: 'ok', remote: 'example-owner/example-repo' })
    expect(result.pullRequests.map((p) => p.number)).toEqual([42])
    const argv = JSON.parse(fs.readFileSync(ghLog, 'utf8').trim().split('\n').at(-1)!)
    expect(argv.slice(0, 4)).toEqual(['pr', 'list', '--repo', 'example-owner/example-repo'])
  })

  it('reports an unauthenticated or missing gh honestly', async () => {
    const git = createGitRunner()
    const r = await resolveRepository(git, repo)
    process.env.FAKE_GH_FAIL = '1'
    try {
      const failed = await fetchPullRequests(git, { id: 'x', ...r }, { command: process.execPath, prefixArgs: [fakeGh] })
      expect(failed.status).toMatchObject({ state: 'error', error: { code: 'gh_not_authenticated' } })
    } finally {
      delete process.env.FAKE_GH_FAIL
    }
    const missing = await fetchPullRequests(git, { id: 'x', ...r }, { command: 'definitely-not-gh-repobs' })
    expect(missing.status.error?.code).toBe('gh_not_installed')
  })

  it('makes no GitHub call until the user enables the integration', async () => {
    fs.rmSync(ghLog, { force: true })
    const t = await startTestServer({ gh: { command: process.execPath, prefixArgs: [fakeGh] } })
    try {
      const c = await t.pair()
      expect((await c.send('POST', '/api/v1/repositories', { path: repo })).status).toBe(201)
      await t.running.monitor.refreshAll()
      await t.running.monitor.tick()
      expect(fs.existsSync(ghLog)).toBe(false)
      expect((await c.send('POST', '/api/v1/pull-requests/refresh', {})).status).toBe(409)
      const snap1 = (await c.get('/api/v1/snapshot')).json()
      expect(snap1.pullRequests).toEqual([])
      expect(snap1.pullRequestStatus).toEqual([])

      expect((await c.send('PATCH', '/api/v1/settings', { github: { enabled: true } })).status).toBe(200)
      await t.running.monitor.tick()
      const snap2 = (await c.get('/api/v1/snapshot')).json()
      expect(snap2.pullRequests.map((p: { number: number }) => p.number)).toEqual([42])
      expect(fs.readFileSync(ghLog, 'utf8').trim().split('\n')).toHaveLength(1)

      await c.send('PATCH', '/api/v1/settings', { github: { enabled: false } })
      expect((await c.get('/api/v1/snapshot')).json().pullRequests).toEqual([])
    } finally {
      await t.close()
    }
  })
})
