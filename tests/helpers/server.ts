import http from 'node:http'
import path from 'node:path'
import { startServer, type RunningServer, type StartOptions } from '../../apps/server/src/app.ts'
import { ClaudeAdapter } from '../../apps/server/src/sessions/adapters/claude.ts'
import { CodexAdapter } from '../../apps/server/src/sessions/adapters/codex.ts'
import { makeTempDir, removeDir } from './tmp.ts'

export interface TestServer {
  running: RunningServer
  dataDir: string
  claudeHome: string
  codexHome: string
  origin: string
  request(method: string, p: string, opts?: RequestOptions): Promise<TestResponse>
  /** Pair and return an authenticated client. */
  pair(): Promise<Client>
  close(): Promise<void>
}

export interface RequestOptions {
  headers?: Record<string, string>
  body?: unknown
  rawBody?: string
}

export interface TestResponse {
  status: number
  headers: http.IncomingHttpHeaders
  text: string
  json: () => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface Client {
  cookie: string
  csrf: string
  get(p: string): Promise<TestResponse>
  send(method: string, p: string, body?: unknown): Promise<TestResponse>
}

export async function startTestServer(overrides: Partial<StartOptions> = {}): Promise<TestServer> {
  const root = makeTempDir('server')
  const dataDir = path.join(root, 'data')
  const claudeHome = path.join(root, 'claude-home')
  const codexHome = path.join(root, 'codex-home')
  const claude = new ClaudeAdapter()
  const codex = new CodexAdapter()
  const running = await startServer({
    dataDir,
    port: 0,
    webDist: null,
    log: () => {},
    adapters: [claude, codex],
    manualMonitor: true,
    ...overrides,
  })
  running.monitor.applySettings(
    running.store.patchSettings({ adapters: { claude: { home: claudeHome }, codex: { home: codexHome } } }),
  )
  const origin = running.url
  const request = (method: string, p: string, opts: RequestOptions = {}) =>
    new Promise<TestResponse>((resolve, reject) => {
      const payload = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body))
      const req = http.request(
        {
          host: '127.0.0.1',
          port: running.port,
          method,
          path: p,
          headers: {
            Host: `127.0.0.1:${running.port}`,
            ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...opts.headers,
          },
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (c: string) => (text += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) }))
        },
      )
      req.on('error', reject)
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  const pair = async (): Promise<Client> => {
    const token = running.tokens.mintPairingToken()
    const res = await request('POST', '/api/v1/auth/pair', { headers: { Origin: origin }, body: { token } })
    if (res.status !== 200) throw new Error(`pairing failed ${res.status} ${res.text}`)
    const cookie = String(res.headers['set-cookie']?.[0]).split(';')[0]!
    const csrf = res.json().csrfToken as string
    return {
      cookie,
      csrf,
      get: (p) => request('GET', p, { headers: { Cookie: cookie } }),
      send: (method, p, body) =>
        request(method, p, { headers: { Cookie: cookie, Origin: origin, 'X-Repobs-CSRF': csrf }, body }),
    }
  }
  const server: TestServer = {
    running,
    dataDir,
    claudeHome,
    codexHome,
    origin,
    request,
    pair,
    async close() {
      await server.running.close()
      removeDir(root)
    },
  }
  return server
}
