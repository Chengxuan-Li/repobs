import { startServer } from './app.ts'
import { APP_VERSION, clearRuntime, resolveDataDir, resolvePort, writeRuntime } from './config/config.ts'
import { createLogger } from './config/logger.ts'
import { openInBrowser } from './platform/browser.ts'

// repobs server entry point. Binds to 127.0.0.1 only. Flags:
//   --open   open the default browser with a one-time pairing link once the server is healthy
//   --port N preferred port (also REPOBS_PORT); the next free port is used if it is busy

async function main() {
  // The launcher may disappear (closed window, killed process); a broken console pipe must not crash
  // the server before it shuts down cleanly.
  process.stdout.on('error', () => undefined)
  process.stderr.on('error', () => undefined)
  const args = process.argv.slice(2)
  const portArg = args.indexOf('--port')
  const dataDir = resolveDataDir()
  const log = createLogger(dataDir)
  const port = portArg >= 0 ? Number(args[portArg + 1]) : resolvePort()
  const devOrigin = process.env.REPOBS_DEV_UI_ORIGIN
  const running = await startServer({
    dataDir,
    port,
    portFallback: true,
    extraOrigins: devOrigin ? [devOrigin] : undefined,
    log,
  })
  writeRuntime(dataDir, { pid: process.pid, port: running.port, url: running.url, startedAt: new Date().toISOString(), version: APP_VERSION })
  const pairUrl = `${devOrigin ?? running.url}/#pair=${running.tokens.mintPairingToken()}`
  log('info', `repobs ${APP_VERSION} listening on ${running.url} (loopback only); data in ${dataDir}`)
  // The pairing link is printed to this console only (never to the log file) and expires in 5 minutes.
  console.log(`\n  Open repobs: ${pairUrl}\n  (one-time link, valid 5 minutes; run \`npm run open\` for a new one)\n`)
  // Machine-readable line for scripts/start.mjs.
  console.log(`REPOBS_READY ${JSON.stringify({ port: running.port, url: running.url })}`)
  if (args.includes('--open')) openInBrowser(pairUrl)

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    log('info', `Shutting down (${signal})`)
    clearRuntime(dataDir, process.pid)
    await running.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGBREAK', () => void shutdown('SIGBREAK'))

  // Started by scripts/start.mjs: exit with the launcher even if it is killed abruptly (Windows does
  // not terminate child processes with their parent), so no orphan server keeps running.
  const parentPid = Number(process.env.REPOBS_PARENT_PID)
  if (Number.isInteger(parentPid) && parentPid > 0) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') void shutdown('launcher exited')
      }
    }, 2_000).unref()
  }
}

main().catch((err: unknown) => {
  console.error(`repobs failed to start: ${(err as Error).message}`)
  process.exit(1)
})
