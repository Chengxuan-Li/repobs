import { describe, expect, it } from 'vitest'
import { parseRefs, parseRemotes, parseStatusV2, parseTrack, parseWorktreeList } from '../../apps/server/src/git/parse.ts'

describe('parseWorktreeList', () => {
  it('parses NUL-delimited records including detached, locked, prunable and odd paths', () => {
    const out =
      'worktree C:/src/repo a\0HEAD 1111111111111111111111111111111111111111\0branch refs/heads/main\0\0' +
      'worktree C:/src/wt ü\nnewline\0HEAD 2222222222222222222222222222222222222222\0detached\0locked reason here\0\0' +
      'worktree C:/src/gone\0HEAD 3333333333333333333333333333333333333333\0branch refs/heads/x\0prunable gitdir file points to non-existent location\0\0'
    const wts = parseWorktreeList(out)
    expect(wts).toHaveLength(3)
    expect(wts[0]).toMatchObject({ path: 'C:/src/repo a', branch: 'refs/heads/main', detached: false })
    expect(wts[1]).toMatchObject({ path: 'C:/src/wt ü\nnewline', detached: true, locked: true, lockReason: 'reason here' })
    expect(wts[2]).toMatchObject({ prunable: true, prunableReason: expect.stringContaining('non-existent') })
  })

  it('handles bare entries and unknown attributes', () => {
    const wts = parseWorktreeList('worktree C:/x.git\0bare\0future-attr 1\0\0')
    expect(wts).toEqual([{ path: 'C:/x.git', bare: true, detached: false, locked: false, prunable: false }])
  })
})

describe('parseStatusV2', () => {
  it('counts staged, unstaged, untracked, conflicted and handles renames and spaces', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 a b staged file.txt',
      '1 .M N... 100644 100644 100644 a b unstaged.txt',
      '1 MM N... 100644 100644 100644 a b both.txt',
      '2 R. N... 100644 100644 100644 a b R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
      '? untracked ü.txt',
      '? another\nnewline.txt',
      '! ignored.log',
      '',
    ].join('\0')
    const s = parseStatusV2(out)
    expect(s).toMatchObject({
      oid: 'abc',
      head: 'feature/x',
      upstream: 'origin/feature/x',
      ahead: 2,
      behind: 1,
      staged: 3,
      unstaged: 2,
      untracked: 2,
      conflicted: 1,
      ignored: 1,
    })
  })

  it('recognizes unborn and detached heads', () => {
    expect(parseStatusV2('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ unborn: true, head: 'main' })
    expect(parseStatusV2('# branch.oid abc\0# branch.head (detached)\0')).toMatchObject({ detached: true })
  })
})

describe('parseRefs / parseTrack / parseRemotes', () => {
  it('parses six NUL-terminated fields per record', () => {
    const rec = (...f: string[]) => f.map((x) => x + '\0').join('') + '\n'
    const out =
      rec('refs/heads/main', 'aaa', 'refs/remotes/origin/main', 'ahead 1, behind 2', 'C:/src/repo', '') +
      rec('refs/remotes/origin/HEAD', 'aaa', '', '', '', 'refs/remotes/origin/main') +
      rec('refs/heads/gone', 'bbb', 'refs/remotes/origin/gone', 'gone', '', '')
    const refs = parseRefs(out)
    expect(refs).toHaveLength(3)
    expect(refs[0]).toMatchObject({
      refname: 'refs/heads/main',
      upstream: 'refs/remotes/origin/main',
      worktreePath: 'C:/src/repo',
    })
    expect(refs[1]!.symref).toBe('refs/remotes/origin/main')
    expect(parseTrack(refs[0]!.track)).toEqual({ gone: false, ahead: 1, behind: 2 })
    expect(parseTrack('gone')).toEqual({ gone: true })
    expect(parseTrack('')).toEqual({ gone: false, ahead: 0, behind: 0 })
  })

  it('parses remotes', () => {
    expect(
      parseRemotes('origin\thttps://github.com/o/r.git (fetch)\norigin\thttps://github.com/o/r.git (push)\n'),
    ).toEqual([{ name: 'origin', url: 'https://github.com/o/r.git' }])
  })
})
