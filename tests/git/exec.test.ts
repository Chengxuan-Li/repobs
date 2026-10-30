import { describe, expect, it } from 'vitest'
import { assertAllowedGitArgs, createGitRunner, GitError, LOG_FORMAT, LOG_MAX_COUNT, REF_FORMAT } from '../../apps/server/src/git/exec.ts'

const LOG = ['log', '--no-color', '-z', `--format=${LOG_FORMAT}`, `--max-count=${LOG_MAX_COUNT}`, '--branches', '--remotes']

describe('Git allowlist', () => {
  it.each([
    [['--version']],
    [['rev-parse', '--path-format=absolute', '--git-common-dir', '--is-bare-repository']],
    [['worktree', 'list', '--porcelain', '-z']],
    [['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']],
    [['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes']],
    [['remote', '-v']],
    [LOG],
    [[...LOG, 'a'.repeat(40)]],
  ])('allows read-only inspection %j', (args) => {
    expect(() => assertAllowedGitArgs(args)).not.toThrow()
  })

  it.each([
    [['fetch']],
    [['pull']],
    [['push']],
    [['checkout', 'main']],
    [['commit', '-m', 'x']],
    [['worktree', 'add', 'x']],
    [['worktree', 'remove', 'x']],
    [['worktree', 'prune']],
    [['branch', '-D', 'x']],
    [['reset', '--hard']],
    [['stash']],
    [['clean', '-fdx']],
    [['status', '--porcelain=v2', '--output=evil']],
    [['rev-parse', '--git-dir', '; rm -rf /']],
    [['remote', 'add', 'x', 'y']],
    [['for-each-ref', '--format=%(refname)', 'refs/heads']],
    [['-c', 'core.pager=evil', 'status']],
    [['log']],
    [['log', '-p']],
    [[...LOG, '--output=x']],
    [[...LOG, '--exec=calc']],
    [[...LOG, 'main; rm -rf /']],
    [['log', '--no-color', '-z', '--format=%B', '--max-count=400', '--branches', '--remotes']],
    [['constructor']],
    [['__proto__']],
    [[]],
  ])('rejects %j', (args) => {
    expect(() => assertAllowedGitArgs(args)).toThrow(GitError)
  })

  it('never spawns a process for a rejected command', async () => {
    const spawned: string[][] = []
    const git = createGitRunner({ onSpawn: (argv) => spawned.push([...argv]) })
    await expect(git('C:\\x', ['fetch', '--all'])).rejects.toThrow(/not an allowed/)
    expect(spawned).toEqual([])
  })

  it('rejects option-looking or NUL-containing paths', async () => {
    const git = createGitRunner()
    await expect(git('--exec-path=x', ['--version'])).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(git('C:\\a\0b', ['--version'])).rejects.toMatchObject({ code: 'invalid_path' })
  })

  it('reports a missing git executable clearly', async () => {
    const git = createGitRunner({ executable: 'definitely-not-git-repobs' })
    await expect(git(process.cwd(), ['--version'])).rejects.toMatchObject({ code: 'git_not_found' })
  })
})
