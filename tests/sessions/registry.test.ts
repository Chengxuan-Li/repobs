import { describe, expect, it } from 'vitest'
import type { Worktree } from '@repobs/contracts'
import { associate } from '../../apps/server/src/sessions/registry.ts'

// Session matching with registered folders without Git next to repositories (ADR 0011). Paths are
// synthetic and need not exist: a cwd equal to a worktree root is matched without a disk check.

const root = process.platform === 'win32' ? 'C:\\synthetic' : '/synthetic'
const join = (...parts: string[]) => [root, ...parts].join(process.platform === 'win32' ? '\\' : '/')

const wt = (id: string, repoId: string, p: string): Worktree => ({
  id,
  repoId,
  path: p,
  displayName: id,
  isPrimary: true,
  bare: false,
  detached: false,
  locked: false,
  prunable: false,
  missing: false,
  status: { state: 'unavailable', staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
})

describe('associate with folders', () => {
  const folder = wt('wt_folder', 'folder_aaaaaaaaaaaa', join('work'))
  const nested = wt('wt_nested', 'repo_bbbbbbbbbbbb', join('work', 'app'))

  it('matches a session in a registered folder', () => {
    expect(associate(join('work'), [folder], undefined, new Set())).toMatchObject({ association: 'matched', worktreeId: 'wt_folder' })
  })

  it('gives a registered repository inside the folder its own sessions (deepest root wins)', () => {
    expect(associate(join('work', 'app'), [folder, nested], undefined, new Set())).toMatchObject({ worktreeId: 'wt_nested' })
    expect(associate(join('work', 'app'), [nested, folder], undefined, new Set())).toMatchObject({ worktreeId: 'wt_nested' })
  })

  it('prefers a Git worktree over a folder registered at the same path, in either order', () => {
    const same = wt('wt_git', 'repo_cccccccccccc', join('work'))
    expect(associate(join('work'), [folder, same], undefined, new Set())).toMatchObject({ worktreeId: 'wt_git' })
    expect(associate(join('work'), [same, folder], undefined, new Set())).toMatchObject({ worktreeId: 'wt_git' })
  })

  it('does not match a session outside every registration', () => {
    expect(associate(join('elsewhere'), [folder, nested], undefined, new Set())).toEqual({})
  })
})
