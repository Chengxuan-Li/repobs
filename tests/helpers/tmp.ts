import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** A fresh temporary directory with a space in its name (mirrors typical Windows profile paths). */
export function makeTempDir(prefix: string): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `repobs ${prefix}-`)))
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
