import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { createRequestHandler } from './api/server.ts'
import { APP_VERSION, PORT_ATTEMPTS, resolveWebDist } from './config/config.ts'
import { createLogger, type Logger } from './config/logger.ts'
import { createGitRunner, type GitRunner } from './git/exec.ts'
import type { GhOptions } from './git/pulls.ts'
import { Monitor } from './monitoring/monitor.ts'
import { openDatabase } from './persistence/database.ts'
import { AppStore } from './persistence/store.ts'
import { loadOrCreateSecret, TokenService } from './security/tokens.ts'
import { ClaudeAdapter } from './sessions/adapters/claude.ts'
import { CodexAdapter } from './sessions/adapters/codex.ts'
import type { SessionAdapter } from './sessions/types.ts'

export interface StartOptions {
  dataDir: string
  port: number
  /** Try the next ports when the requested one is busy. */
  portFallback?: boolean
  host?: string
  extraOrigins?: string[]
  webDist?: string | null
  git?: GitRunner
  adapters?: SessionAdapter[]
  gh?: GhOptions
  log?: Logger
  manualMonitor?: boolean
}

export interface RunningServer {
  url: string
  port: number
  server: http.Server
  monitor: Monitor
  store: AppStore
  tokens: TokenService
  close(): Promise<void>
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const log = options.log ?? createLogger(options.dataDir)
  const opened = openDatabase(path.join(options.dataDir, 'repobs.db'))
  if (opened.recoveredFromCorruption) {
    log('error', `The app database was unreadable and was moved aside to ${opened.recoveredFromCorruption}; a new one was created.`)
  }
  for (const b of opened.backups) log('info', `Database backed up before migration: ${b}`)
  const store = new AppStore(opened.db)
  const tokens = new TokenService(loadOrCreateSecret(options.dataDir))
  const monitor = new Monitor({
    store,
    git: options.git ?? createGitRunner(),
    adapters: options.adapters ?? [new ClaudeAdapter(), new CodexAdapter()],
    gh: options.gh,
    log,
    manual: options.manualMonitor,
  })
  const policy = { port: options.port, extraOrigins: options.extraOrigins }
  const startedAt = new Date().toISOString()
  const handler = createRequestHandler({
    monitor,
    store,
    tokens,
    policy,
    webDist: options.webDist === null ? undefined : (options.webDist ?? resolveWebDist()),
    log,
    version: APP_VERSION,
    startedAt,
    dataDir: options.dataDir,
    database: { path: opened.path, schemaVersion: opened.schemaVersion, recoveredFromCorruption: opened.recoveredFromCorruption },
  })
  const server = http.createServer((req, res) => void handler(req, res))
  server.headersTimeout = 20_000
  server.requestTimeout = 60_000

  const host = options.host ?? '127.0.0.1'
  const attempts = options.portFallback ? PORT_ATTEMPTS : 1
  let port = options.port
  for (let i = 0; ; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve()
        })
      })
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE' && i + 1 < attempts && port !== 0) {
        log('warn', `Port ${port} is in use; trying ${port + 1}`)
        port++
        continue
      }
      opened.db.close()
      throw err
    }
  }
  port = (server.address() as AddressInfo).port
  policy.port = port

  await monitor.start()
  const url = `http://127.0.0.1:${port}`
  let closed = false
  return {
    url,
    port,
    server,
    monitor,
    store,
    tokens,
    async close() {
      if (closed) return
      closed = true
      await monitor.stop()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      opened.db.close()
    },
  }
}
