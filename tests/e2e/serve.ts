// Starts the built repobs server on synthetic demo data for Playwright (never real data).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDemo } from '../../scripts/demo.ts'
import { e2eStateFile } from './state.ts'

const port = Number(process.argv[2] ?? 47399)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repobs e2e-'))
const demo = buildDemo(root)

// Many extra historical sessions in repo B to exercise tree virtualization.
const { writeClaudeSession, claude } = await import('../../fixtures/session-fixtures.ts')
for (let i = 0; i < 350; i++) {
  const id = `bulk0000-0000-4000-8000-${String(i).padStart(12, '0')}`
  writeClaudeSession(demo.claudeHome, demo.git.repoB, id, [claude.title(id, `Bulk session ${i}`), claude.endTurn(id, demo.git.repoB, Date.now() - (i + 10) * 3_600_000)])
}

process.env.REPOBS_DATA_DIR = demo.dataDir
process.env.CLAUDE_CONFIG_DIR = demo.claudeHome
process.env.CODEX_HOME = demo.codexHome
process.env.REPOBS_PORT = String(port)
fs.writeFileSync(e2eStateFile(port), JSON.stringify({ root, dataDir: demo.dataDir, claudeHome: demo.claudeHome, git: demo.git }))

const cleanup = () => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
    fs.rmSync(e2eStateFile(port), { force: true })
  } catch {
    // best effort
  }
}
process.on('exit', cleanup)
await import('../../apps/server/dist/index.js')
