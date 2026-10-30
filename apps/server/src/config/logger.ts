import fs from 'node:fs'
import path from 'node:path'
import { redactHome } from '../platform/paths.ts'

// Minimal structured logger. Messages are written by our own code only (no request bodies,
// no provider content, no tokens); paths under the user profile are shown as `~`.

export type LogLevel = 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const TOKEN_PATTERN = /\b(?:p1|s1)\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

export function redactLogMessage(message: string): string {
  return message
    .replace(TOKEN_PATTERN, '[redacted-token]')
    .replace(/[A-Za-z]:\\[^\s"']+/g, (p) => redactHome(p))
}

export function createLogger(dataDir: string | undefined, options: { quiet?: boolean } = {}) {
  let file: string | undefined
  if (dataDir) {
    const dir = path.join(dataDir, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    file = path.join(dir, 'server.log')
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, file + '.1')
    } catch {
      // no log yet
    }
  }
  return (level: LogLevel, message: string) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redactLogMessage(message)}`
    if (file) {
      try {
        fs.appendFileSync(file, line + '\n')
      } catch {
        // logging must never crash the server
      }
    }
    if (!options.quiet) {
      try {
        ;(level === 'error' ? console.error : console.log)(line)
      } catch {
        // the console pipe may be gone (launcher closed)
      }
    }
  }
}

export type Logger = ReturnType<typeof createLogger>
