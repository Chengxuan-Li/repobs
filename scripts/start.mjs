// `npm start`: start the loopback service, wait until it is healthy, then open the browser with a
// one-time pairing link. If repobs is already running, just open a new pairing link. Ctrl+C stops
// the service cleanly (no orphan process).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkNode, dataDir, gitVersion, health, mintPairingToken, openBrowser, pidAlive, readRuntime, waitForHealth } from './lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const noOpen = process.argv.includes('--no-open')

checkNode()
const serverEntry = path.join(root, 'apps', 'server', 'dist', 'index.js')
if (!fs.existsSync(serverEntry) || !fs.existsSync(path.join(root, 'apps', 'web', 'dist', 'index.html'))) {
  console.error('repobs is not built yet. Run `npm ci` and `npm run build`, then `npm start`.')
  process.exit(1)
}
const git = gitVersion()
if (!git) console.warn('Warning: Git was not found on PATH. repobs will start, but cannot read repositories until Git for Windows is installed.')

const dir = dataDir()
const existing = readRuntime(dir)
if (existing && pidAlive(existing.pid) && (await health(existing.port))) {
  const url = `http://127.0.0.1:${existing.port}/#pair=${mintPairingToken(dir)}`
  console.log(`repobs is already running on http://127.0.0.1:${existing.port} (pid ${existing.pid}).`)
  if (noOpen) console.log(`Pairing link (valid 5 minutes): ${url}`)
  else openBrowser(url)
  process.exit(0)
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: { ...process.env, REPOBS_PARENT_PID: String(process.pid) },
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: false,
})
let ready
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith('REPOBS_READY ')) ready = JSON.parse(line.slice('REPOBS_READY '.length))
    else if (line.trim() && !line.includes('#pair=')) console.log(line)
  }
})
const stop = () => {
  if (!child.killed) child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('SIGBREAK', stop)
child.on('exit', (code) => process.exit(code ?? 0))

const start = Date.now()
while (!ready && Date.now() - start < 30_000 && child.exitCode === null) await new Promise((r) => setTimeout(r, 100))
if (!ready) {
  console.error('repobs did not report readiness within 30 seconds; see the log in ' + path.join(dir, 'logs'))
  stop()
  process.exit(1)
}
const ok = await waitForHealth(ready.port)
if (!ok) {
  console.error('repobs started but its health check failed; not opening the browser.')
  stop()
  process.exit(1)
}
const url = `${ready.url}/#pair=${mintPairingToken(dir)}`
console.log(`\nrepobs is running at ${ready.url} (loopback only). Press Ctrl+C to stop.`)
if (noOpen) console.log(`Pairing link (valid 5 minutes): ${url}`)
else openBrowser(url)
