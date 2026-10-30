import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_VERSION = '0.1.0'
export const DEFAULT_PORT = 47321
export const PORT_ATTEMPTS = 10

/** App data directory: %LOCALAPPDATA%\repobs on Windows (override: REPOBS_DATA_DIR). */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REPOBS_DATA_DIR) return path.resolve(env.REPOBS_DATA_DIR)
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'repobs')
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'repobs')
  return path.join(env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'repobs')
}

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.REPOBS_PORT)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT
}

export interface RuntimeInfo {
  pid: number
  port: number
  url: string
  startedAt: string
  version: string
}

export function runtimeFile(dataDir: string): string {
  return path.join(dataDir, 'runtime.json')
}

export function writeRuntime(dataDir: string, info: RuntimeInfo): void {
  fs.writeFileSync(runtimeFile(dataDir), JSON.stringify(info, null, 2), { mode: 0o600 })
}

export function clearRuntime(dataDir: string, pid: number): void {
  try {
    const current = JSON.parse(fs.readFileSync(runtimeFile(dataDir), 'utf8')) as RuntimeInfo
    if (current.pid === pid) fs.rmSync(runtimeFile(dataDir))
  } catch {
    // nothing to clear
  }
}

/** Locate the built web UI (apps/web/dist) relative to the server build or source. */
export function resolveWebDist(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [path.resolve(here, '../../../web/dist'), path.resolve(here, '../../web/dist')]) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate
  }
  return undefined
}
