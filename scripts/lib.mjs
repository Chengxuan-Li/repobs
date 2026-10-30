// Shared helpers for the launcher scripts (plain Node, no dependencies).
import { createHmac, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export function dataDir(env = process.env) {
  if (env.REPOBS_DATA_DIR) return path.resolve(env.REPOBS_DATA_DIR)
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'repobs')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'repobs')
  return path.join(env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'repobs')
}

export function readRuntime(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** Mint a one-time pairing token; must match apps/server/src/security/tokens.ts. */
export function mintPairingToken(dir, now = Date.now()) {
  const hex = fs.readFileSync(path.join(dir, 'secret.key'), 'utf8').trim()
  const secret = Buffer.from(hex, 'hex')
  const exp = String(now + 5 * 60_000)
  const nonce = randomBytes(16).toString('base64url')
  const sig = createHmac('sha256', secret).update(['pair', exp, nonce].join('|')).digest('base64url')
  return `p1.${exp}.${nonce}.${sig}`
}

export function health(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/health', timeout: timeoutMs, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          resolve(res.statusCode === 200 && json.name === 'repobs' ? json : undefined)
        } catch {
          resolve(undefined)
        }
      })
    })
    req.on('error', () => resolve(undefined))
    req.on('timeout', () => {
      req.destroy()
      resolve(undefined)
    })
  })
}

export async function waitForHealth(port, timeoutMs = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const h = await health(port)
    if (h) return h
    await new Promise((r) => setTimeout(r, 250))
  }
  return undefined
}

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => console.log(`Open this link in your browser: ${url}`))
    child.unref()
  } catch {
    console.log(`Open this link in your browser: ${url}`)
  }
}

export function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 11)) {
    console.error(`repobs needs Node.js 24 LTS (24.11 or newer); this is ${process.versions.node}. Install it from https://nodejs.org/.`)
    process.exit(1)
  }
  if (major > 24) console.warn(`Note: repobs is tested on Node.js 24; you are running ${process.versions.node}.`)
}

export function gitVersion() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8', shell: false, windowsHide: true })
  return r.status === 0 ? r.stdout.trim() : undefined
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
