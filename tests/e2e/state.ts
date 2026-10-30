import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GitFixture } from '../../fixtures/git-fixtures.ts'

export interface E2EState {
  root: string
  dataDir: string
  claudeHome: string
  git: GitFixture
}

export const e2eStateFile = (port: number) => path.join(os.tmpdir(), `repobs-e2e-${port}.json`)

export function readE2EState(port: number): E2EState {
  return JSON.parse(fs.readFileSync(e2eStateFile(port), 'utf8')) as E2EState
}
