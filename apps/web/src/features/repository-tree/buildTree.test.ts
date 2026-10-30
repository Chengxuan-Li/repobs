import { describe, expect, it } from 'vitest'
import { sampleSnapshot } from '../../testing/fixtures'
import { buildTree, filterTree, flattenTree } from './buildTree'

const labels = (rows: ReturnType<typeof flattenTree>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.node.label}`)

describe('buildTree', () => {
  it('builds repository -> branch -> worktree -> sessions with auxiliary groups', () => {
    const tree = buildTree(sampleSnapshot())
    const rows = flattenTree(tree, {})
    expect(labels(rows)).toEqual([
      'Repo A',
      '  main',
      '    repo-a',
      '      Parser fix',
      '      Review tree',
      '  feature',
      '    wt_feat',
      '      Perf spike',
      '  Detached HEAD',
      '    wt_det',
      '  Branches without worktree',
      '  Remote-only',
      '  Unassigned sessions',
      '    Removed worktree work',
    ])
    // A local branch and its remote-tracking ref are not shown as separate worktrees.
    expect(rows.filter((r) => r.node.kind === 'worktree')).toHaveLength(3)
  })

  it('expands collapsed groups on demand and respects overrides', () => {
    const tree = buildTree(sampleSnapshot())
    const rows = flattenTree(tree, { 'group:repo_a:idle': true, 'group:repo_a:remote-only': true, 'branch:repo_a|refs/heads/main': false })
    expect(labels(rows)).toContain('    claude/scratch-a8de')
    expect(labels(rows)).toContain('    origin/remote-only')
    expect(labels(rows)).not.toContain('    repo-a')
  })

  it('attention filter keeps flagged/waiting sessions and conflicted worktrees with ancestors', () => {
    const tree = buildTree(sampleSnapshot())
    const { nodes, forced } = filterTree(tree, { mode: 'attention', query: '', showHistorical: true })
    expect(labels(flattenTree(nodes, {}, forced))).toEqual([
      'Repo A',
      '  main',
      '    repo-a',
      '      Review tree',
      '  feature',
      '    wt_feat',
      '      Perf spike',
    ])
  })

  it('search matches titles, aliases and tags, never needing transcript text', () => {
    const tree = buildTree(sampleSnapshot())
    const byTag = filterTree(tree, { mode: 'all', query: 'perf', showHistorical: true })
    expect(labels(flattenTree(byTag.nodes, {}, byTag.forced)).at(-1)).toBe('      Perf spike')
    const byBranch = filterTree(tree, { mode: 'all', query: 'scratch', showHistorical: true })
    expect(labels(flattenTree(byBranch.nodes, {}, byBranch.forced))).toEqual(['Repo A', '  Branches without worktree', '    claude/scratch-a8de'])
  })

  it('can hide historical sessions, but never ones that need attention', () => {
    const snap = sampleSnapshot()
    snap.sessions.push({ ...snap.sessions[0]!, id: 'claude:old', providerSessionId: 'old', title: 'Old quiet session', historical: true, state: { kind: 'idle_or_turn_finished', confidence: 'inferred', source: 'x' } })
    const { nodes, forced } = filterTree(buildTree(snap), { mode: 'all', query: '', showHistorical: false })
    const l = labels(flattenTree(nodes, {}, forced))
    expect(l).not.toContain('      Old quiet session')
    expect(l).toContain('      Perf spike') // historical but flagged
    expect(l).toContain('      Parser fix')
  })

  it('handles 500 sessions quickly', () => {
    const snap = sampleSnapshot()
    for (let i = 0; i < 500; i++) snap.sessions.push({ ...snap.sessions[0]!, id: `claude:bulk-${i}`, providerSessionId: `bulk-${i}`, title: `Bulk ${i}` })
    const start = performance.now()
    const rows = flattenTree(buildTree(snap), {})
    expect(rows.length).toBeGreaterThan(500)
    expect(performance.now() - start).toBeLessThan(200)
  })
})
