// Synthetic demo environment: disposable Git repositories plus synthetic Claude Code and Codex
// session folders, for trying repobs, screenshots and e2e tests without any real data.
//
//   node scripts/demo.ts <empty-dir>        builds the demo and prints the environment to use
//
// Then start repobs with REPOBS_DATA_DIR, CLAUDE_CONFIG_DIR and CODEX_HOME pointing into <dir>.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGitFixture, fixtureGit, type GitFixture } from '../fixtures/git-fixtures.ts'
import {
  claude,
  codex,
  codexRolloutPath,
  writeClaudeSession,
  writeClaudeSubagent,
  writeCodexIndex,
  writeCodexRollout,
} from '../fixtures/session-fixtures.ts'

export interface Demo {
  root: string
  git: GitFixture
  dataDir: string
  claudeHome: string
  codexHome: string
}

export function buildDemo(root: string, now = Date.now()): Demo {
  const ago = (m: number) => now - m * 60_000
  fs.mkdirSync(root, { recursive: true })
  const git = buildGitFixture(path.join(root, 'src'))
  const claudeHome = path.join(root, 'claude-home')
  const codexHome = path.join(root, 'codex-home')
  const dataDir = path.join(root, 'repobs-data')
  const { repoA, repoB, worktrees } = git

  // A branch with a run of uneventful history, so "Collapse quiet commits" has something to fold.
  const scratch = path.join(root, 'src', 'repo-a-worktrees', 'scratch-history')
  fixtureGit(repoA, ['worktree', 'add', scratch, 'claude/scratch-a8de'])
  for (let i = 1; i <= 10; i++) {
    fs.writeFileSync(path.join(scratch, 'notes.txt'), `scratch step ${i}\n`)
    fixtureGit(scratch, ['add', 'notes.txt'])
    fixtureGit(scratch, ['commit', '-m', `Scratch step ${i}`])
  }
  fixtureGit(repoA, ['worktree', 'remove', '--force', scratch])

  writeClaudeSession(claudeHome, repoA, 'a1f0c2d4-1111-4aaa-8bbb-000000000001', [
    claude.title('a1f0c2d4-1111-4aaa-8bbb-000000000001', 'Tighten status parser'),
    claude.prompt('a1f0c2d4-1111-4aaa-8bbb-000000000001', repoA, ago(4)),
    claude.toolUse('a1f0c2d4-1111-4aaa-8bbb-000000000001', repoA, ago(2)),
  ])
  writeClaudeSession(claudeHome, repoA, 'b2e1d3c5-2222-4aaa-8bbb-000000000002', [
    claude.title('b2e1d3c5-2222-4aaa-8bbb-000000000002', 'Document worktree states'),
    claude.prompt('b2e1d3c5-2222-4aaa-8bbb-000000000002', repoA, ago(40)),
    claude.endTurn('b2e1d3c5-2222-4aaa-8bbb-000000000002', repoA, ago(38)),
  ])
  writeClaudeSession(claudeHome, worktrees.feature, 'c3d2e4f6-3333-4aaa-8bbb-000000000003', [
    claude.prompt('c3d2e4f6-3333-4aaa-8bbb-000000000003', worktrees.feature, ago(3)),
    claude.endTurn('c3d2e4f6-3333-4aaa-8bbb-000000000003', worktrees.feature, ago(2)),
  ])
  writeClaudeSubagent(
    claudeHome,
    worktrees.feature,
    'c3d2e4f6-3333-4aaa-8bbb-000000000003',
    'demo1',
    [claude.prompt('c3d2e4f6-3333-4aaa-8bbb-000000000003', worktrees.feature, ago(2)), claude.toolUse('c3d2e4f6-3333-4aaa-8bbb-000000000003', worktrees.feature, ago(1))],
    { agentType: 'Explore', description: 'Map the feature module' },
  )
  writeClaudeSubagent(
    claudeHome,
    worktrees.feature,
    'c3d2e4f6-3333-4aaa-8bbb-000000000003',
    'demo2',
    [claude.prompt('c3d2e4f6-3333-4aaa-8bbb-000000000003', worktrees.feature, ago(3)), claude.endTurn('c3d2e4f6-3333-4aaa-8bbb-000000000003', worktrees.feature, ago(2))],
    { agentType: 'Plan', description: 'Draft the test plan' },
  )
  writeClaudeSession(claudeHome, worktrees.conflict, 'd4c3b2a1-4444-4aaa-8bbb-000000000004', [
    claude.title('d4c3b2a1-4444-4aaa-8bbb-000000000004', 'Resolve merge plan'),
    claude.prompt('d4c3b2a1-4444-4aaa-8bbb-000000000004', worktrees.conflict, ago(60 * 30)),
    claude.interrupted('d4c3b2a1-4444-4aaa-8bbb-000000000004', worktrees.conflict, ago(60 * 30 - 1)),
  ])
  writeClaudeSession(claudeHome, path.join(worktrees.removed, 'pkg'), 'e5f6a7b8-5555-4aaa-8bbb-000000000005', [
    claude.title('e5f6a7b8-5555-4aaa-8bbb-000000000005', 'Spike in a removed worktree'),
    claude.endTurn('e5f6a7b8-5555-4aaa-8bbb-000000000005', path.join(worktrees.removed, 'pkg'), ago(60 * 50)),
  ])

  const codexThreads: Array<[string, string, number, string[]]> = [
    ['019a0000-0000-7000-8000-00000000c0d1', repoA, 6, ['task_started', 'task_complete']],
    ['019a0000-0000-7000-8000-00000000c0d2', repoA, 2, ['task_started', 'exec_approval_request']],
    ['019a0000-0000-7000-8000-00000000c0d3', repoB, 9, ['task_started']],
  ]
  for (const [id, cwd, at, events] of codexThreads) {
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, id, ago(at)), [
      codex.meta(id, cwd, ago(at)),
      codex.turnContext(cwd, ago(at)),
      ...events.map((e, i) => codex.event(e, ago(at) + i * 1000)),
    ])
  }
  writeCodexIndex(codexHome, [
    { id: '019a0000-0000-7000-8000-00000000c0d1', thread_name: 'Review ref grouping', updated_at: new Date(ago(5)).toISOString() },
    { id: '019a0000-0000-7000-8000-00000000c0d2', thread_name: 'Add rename detection test', updated_at: new Date(ago(2)).toISOString() },
  ])
  return { root, git, dataDir, claudeHome, codexHome }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: node scripts/demo.ts <empty-directory>')
    process.exit(1)
  }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    console.error('Refusing to write into a non-empty directory.')
    process.exit(1)
  }
  const demo = buildDemo(path.resolve(dir))
  console.log('Synthetic demo created. Start repobs with:')
  console.log(`  $env:REPOBS_DATA_DIR = '${demo.dataDir}'`)
  console.log(`  $env:CLAUDE_CONFIG_DIR = '${demo.claudeHome}'`)
  console.log(`  $env:CODEX_HOME = '${demo.codexHome}'`)
  console.log('  npm start')
  console.log(`Then add ${demo.git.repoA} and ${demo.git.repoB}.`)
}
