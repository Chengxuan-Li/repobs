import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { z } from 'zod'
import {
  AnnotationExport,
  AnnotationInput,
  API_PREFIX,
  CSRF_HEADER,
  type Diagnostics,
  PairRequest,
  RegisterRepositoriesRequest,
  RegisterRepositoryRequest,
  ReorderRepositoriesRequest,
  SESSION_COOKIE,
  SessionAnnotation,
  SettingsPatch,
  UpdateRepositoryRequest,
} from '@repobs/contracts'
import type { Logger } from '../config/logger.ts'
import { type Monitor, RegistrationError } from '../monitoring/monitor.ts'
import type { AppStore } from '../persistence/store.ts'
import { folderPickerSupported, pickFolder } from '../platform/folderPicker.ts'
import { isAbsoluteLocalPath, redactHome } from '../platform/paths.ts'
import {
  checkHostAndOrigin,
  CONTENT_SECURITY_POLICY,
  type OriginPolicy,
  parseCookies,
  SECURITY_HEADERS,
} from '../security/guard.ts'
import { SESSION_TTL_MS, type TokenService } from '../security/tokens.ts'

export interface AppContext {
  monitor: Monitor
  store: AppStore
  tokens: TokenService
  policy: OriginPolicy
  webDist?: string
  log: Logger
  version: string
  startedAt: string
  dataDir: string
  database: { path: string; schemaVersion: number; recoveredFromCorruption?: string }
}

class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface RequestCtx {
  req: IncomingMessage
  res: ServerResponse
  params: string[]
  url: URL
  session?: { nonce: string; expiresAt: string }
  body?: unknown
}

type Handler = (ctx: RequestCtx) => Promise<unknown> | unknown

interface Route {
  method: string
  pattern: RegExp
  auth: boolean
  handler: Handler
  maxBody?: number
}

const SESSION_ID = /^(claude|codex):[A-Za-z0-9._-]{1,128}$/
const REPO_ID = /^repo_[0-9a-f]{12}$/
const MAX_SSE_CLIENTS = 32

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function sendError(res: ServerResponse, status: number, code: string, message: string) {
  if (!res.headersSent) sendJson(res, status, { error: { code, message } })
  else res.end()
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Expected application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request body too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  } catch {
    throw new HttpError(400, 'invalid_json', 'Malformed JSON')
  }
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new HttpError(400, 'validation_failed', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request')
  }
  return parsed.data
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`
}

export function createRequestHandler(app: AppContext) {
  const { monitor, store, tokens } = app
  let sseClients = 0

  const sessionParam = (ctx: RequestCtx) => {
    const id = decodeURIComponent(ctx.params[0] ?? '')
    if (!SESSION_ID.test(id)) throw new HttpError(400, 'invalid_session_id', 'Invalid session id')
    return id
  }
  const repoParam = (ctx: RequestCtx) => {
    const id = ctx.params[0] ?? ''
    if (!REPO_ID.test(id)) throw new HttpError(400, 'invalid_repository_id', 'Invalid repository id')
    return id
  }

  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/health$/,
      auth: false,
      handler: () => ({ ok: true, name: 'repobs', version: app.version, monitor: monitor.monitorHealth().state }),
    },
    {
      method: 'POST',
      pattern: /^\/auth\/pair$/,
      auth: false,
      handler: ({ res, body }) => {
        const { token } = validate(PairRequest, body)
        if (!tokens.consumePairingToken(token)) {
          throw new HttpError(401, 'pairing_failed', 'This pairing link is invalid, expired or already used. Run `npm start` (or `npm run open`) again.')
        }
        const s = tokens.mintSession()
        res.setHeader('Set-Cookie', sessionCookie(s.cookie, SESSION_TTL_MS / 1000))
        return { csrfToken: s.csrf, expiresAt: s.expiresAt }
      },
    },
    {
      method: 'GET',
      pattern: /^\/auth\/session$/,
      auth: true,
      handler: ({ session }) => ({ csrfToken: tokens.csrfFor(session!.nonce), expiresAt: session!.expiresAt }),
    },
    {
      method: 'POST',
      pattern: /^\/auth\/logout$/,
      auth: true,
      handler: ({ res, session }) => {
        tokens.revokeSession(session!.nonce, session!.expiresAt)
        res.setHeader('Set-Cookie', sessionCookie('', 0))
        return { ok: true }
      },
    },
    { method: 'GET', pattern: /^\/snapshot$/, auth: true, handler: () => monitor.snapshot() },
    { method: 'GET', pattern: /^\/repositories$/, auth: true, handler: () => monitor.snapshot().repositories },
    {
      method: 'POST',
      pattern: /^\/repositories$/,
      auth: true,
      handler: async ({ res, body }) => {
        const input = validate(RegisterRepositoryRequest, body)
        try {
          const repo = await monitor.registerRepository(input.path, input.displayName)
          res.statusCode = 201
          return repo
        } catch (err) {
          if (err instanceof RegistrationError) throw new HttpError(err.status, err.code, err.message)
          throw err
        }
      },
    },
    {
      method: 'POST',
      pattern: /^\/repositories\/batch$/,
      auth: true,
      handler: async ({ body }) => monitor.registerRepositories(validate(RegisterRepositoriesRequest, body).paths),
    },
    {
      method: 'GET',
      pattern: /^\/repositories\/suggestions$/,
      auth: true,
      handler: async () => ({ suggestions: await monitor.suggestions() }),
    },
    {
      method: 'POST',
      pattern: /^\/repositories\/pick-directory$/,
      auth: true,
      handler: async () => {
        if (!folderPickerSupported()) throw new HttpError(501, 'unsupported', 'The native folder picker is only available on Windows; enter the path instead.')
        try {
          return await pickFolder()
        } catch (err) {
          const code = (err as { code?: string }).code ?? 'picker_failed'
          throw new HttpError(code === 'busy' ? 409 : 500, code, (err as Error).message)
        }
      },
    },
    {
      method: 'POST',
      pattern: /^\/repositories\/reorder$/,
      auth: true,
      handler: ({ body }) => {
        monitor.reorderRepositories(validate(ReorderRepositoriesRequest, body).ids)
        return { ok: true }
      },
    },
    {
      method: 'PATCH',
      pattern: /^\/repositories\/([^/]+)$/,
      auth: true,
      handler: (ctx) => {
        const id = repoParam(ctx)
        const { displayName } = validate(UpdateRepositoryRequest, ctx.body)
        if (!monitor.renameRepository(id, displayName)) throw new HttpError(404, 'not_found', 'Repository not registered')
        return { ok: true }
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/repositories\/([^/]+)$/,
      auth: true,
      handler: (ctx) => {
        // Removes the dashboard entry only. No file or Git data is touched.
        if (!monitor.unregisterRepository(repoParam(ctx))) throw new HttpError(404, 'not_found', 'Repository not registered')
        return { ok: true, filesDeleted: false }
      },
    },
    {
      method: 'GET',
      pattern: /^\/repositories\/([^/]+)\/pull-requests$/,
      auth: true,
      handler: (ctx) => {
        const id = repoParam(ctx)
        const snap = monitor.snapshot()
        return {
          status: snap.pullRequestStatus.find((s) => s.repoId === id) ?? { repoId: id, state: 'disabled' },
          pullRequests: snap.pullRequests.filter((p) => p.repoId === id),
        }
      },
    },
    {
      method: 'POST',
      pattern: /^\/pull-requests\/refresh$/,
      auth: true,
      handler: async () => {
        if (!store.getSettings().github.enabled) throw new HttpError(409, 'github_disabled', 'Enable the GitHub integration in Settings first')
        await monitor.refreshPullRequests()
        return { ok: true }
      },
    },
    { method: 'GET', pattern: /^\/sessions$/, auth: true, handler: () => monitor.snapshot().sessions },
    {
      method: 'GET',
      pattern: /^\/sessions\/([^/]+)$/,
      auth: true,
      handler: (ctx) => {
        const id = sessionParam(ctx)
        const session = monitor.snapshot().sessions.find((s) => s.id === id)
        if (!session) throw new HttpError(404, 'not_found', 'Session not found')
        return { session, annotation: store.getAnnotation(id) ?? null }
      },
    },
    {
      method: 'GET',
      pattern: /^\/sessions\/([^/]+)\/annotation$/,
      auth: true,
      handler: (ctx) => ({ annotation: store.getAnnotation(sessionParam(ctx)) ?? null }),
    },
    {
      method: 'PUT',
      pattern: /^\/sessions\/([^/]+)\/annotation$/,
      auth: true,
      handler: (ctx) => {
        const id = sessionParam(ctx)
        const input = validate(AnnotationInput, ctx.body)
        if (!monitor.sessionExists(id) && !store.getAnnotation(id)) throw new HttpError(404, 'not_found', 'Session not found')
        const annotation = store.putAnnotation(id, input)
        monitor.annotationsChanged()
        return { annotation }
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/sessions\/([^/]+)\/annotation$/,
      auth: true,
      handler: (ctx) => {
        const deleted = store.deleteAnnotation(sessionParam(ctx))
        monitor.annotationsChanged()
        return { ok: true, deleted }
      },
    },
    {
      method: 'GET',
      pattern: /^\/annotations\/export$/,
      auth: true,
      handler: ({ res }) => {
        res.setHeader('Content-Disposition', 'attachment; filename="repobs-annotations.json"')
        return { format: 'repobs-annotations', version: 1, exportedAt: new Date().toISOString(), annotations: store.listAnnotations() }
      },
    },
    {
      method: 'POST',
      pattern: /^\/annotations\/import$/,
      auth: true,
      maxBody: 20 * 1024 * 1024,
      handler: ({ body }) => {
        const data = validate(AnnotationExport, body)
        let imported = 0
        let skipped = 0
        for (const a of data.annotations) {
          const parsed = SessionAnnotation.safeParse(a)
          const existing = parsed.success && SESSION_ID.test(a.sessionId) ? store.getAnnotation(a.sessionId) : undefined
          if (!parsed.success || !SESSION_ID.test(a.sessionId) || (existing && existing.updatedAt >= a.updatedAt)) {
            skipped++
            continue
          }
          store.writeAnnotation(parsed.data)
          imported++
        }
        monitor.annotationsChanged()
        return { imported, skipped }
      },
    },
    { method: 'GET', pattern: /^\/settings$/, auth: true, handler: () => store.getSettings() },
    {
      method: 'PATCH',
      pattern: /^\/settings$/,
      auth: true,
      handler: ({ body }) => {
        const patch = validate(SettingsPatch, body)
        for (const p of [patch.adapters?.claude?.home, patch.adapters?.codex?.home]) {
          if (p && !isAbsoluteLocalPath(p)) throw new HttpError(400, 'invalid_path', 'Provider homes must be absolute local paths')
        }
        const next = store.patchSettings(patch)
        monitor.applySettings(next)
        return next
      },
    },
    {
      method: 'POST',
      pattern: /^\/rescan$/,
      auth: true,
      handler: async () => {
        await monitor.refreshAll()
        return { ok: true, version: monitor.version }
      },
    },
    {
      method: 'GET',
      pattern: /^\/diagnostics$/,
      auth: true,
      handler: () => {
        const d = monitor.diagnostics()
        const result: Diagnostics & { outsideRegistered: Record<string, number> } = {
          version: app.version,
          startedAt: app.startedAt,
          dataDir: redactHome(app.dataDir),
          git: monitor.gitInfo,
          database: {
            path: redactHome(app.database.path),
            schemaVersion: app.database.schemaVersion,
            recoveredFromCorruption: app.database.recoveredFromCorruption ? redactHome(app.database.recoveredFromCorruption) : undefined,
          },
          monitor: {
            state: monitor.monitorHealth().state,
            lastSyncAt: monitor.monitorHealth().lastSyncAt,
            watchers: d.watchers,
            watcherErrors: d.watcherErrors,
            pollIntervalsMs: d.pollIntervalsMs,
            snapshotVersion: monitor.version,
            sseClients,
          },
          adapters: d.adapters,
          github: d.github,
          outsideRegistered: d.outsideRegistered,
        }
        return result
      },
    },
  ]

  function handleEvents(ctx: RequestCtx) {
    const { req, res } = ctx
    if (sseClients >= MAX_SSE_CLIENTS) throw new HttpError(503, 'too_many_clients', 'Too many open event streams')
    sseClients++
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    send('hello', { version: monitor.version, monitor: monitor.monitorHealth() })
    const onDiff = (diff: unknown) => send('diff', diff)
    const onMonitor = (health: unknown) => send('monitor', health)
    monitor.on('diff', onDiff)
    monitor.on('monitor', onMonitor)
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    const expiry = setTimeout(() => res.end(), Math.max(0, Date.parse(ctx.session!.expiresAt) - Date.now()))
    req.on('close', () => {
      sseClients--
      clearInterval(ping)
      clearTimeout(expiry)
      monitor.off('diff', onDiff)
      monitor.off('monitor', onMonitor)
    })
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')
    if (!app.webDist) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('The repobs web UI is not built. Run `npm run build`, then `npm start`.')
    }
    let rel: string
    try {
      rel = decodeURIComponent(url.pathname)
    } catch {
      return sendError(res, 400, 'bad_path', 'Bad path')
    }
    const root = path.resolve(app.webDist)
    let file = path.resolve(root, '.' + path.posix.normalize('/' + rel))
    if (file !== root && !file.startsWith(root + path.sep)) return sendError(res, 404, 'not_found', 'Not found')
    if (!path.extname(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel) && rel !== '/') return sendError(res, 404, 'not_found', 'Not found')
      file = path.join(root, 'index.html')
    }
    const ext = path.extname(file).toLowerCase()
    const type = CONTENT_TYPES[ext] ?? 'application/octet-stream'
    const headers: Record<string, string> = { 'Content-Type': type }
    if (ext === '.html') {
      headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY
      headers['Cache-Control'] = 'no-cache'
    } else if (file.includes(`${path.sep}assets${path.sep}`)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v)
    const check = checkHostAndOrigin(req, app.policy)
    if (!check.ok) {
      return sendError(res, 403, check.reason, check.reason === 'bad_host' ? 'Unexpected Host header' : 'Cross-origin request rejected')
    }
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      return sendError(res, 400, 'bad_url', 'Bad URL')
    }
    if (!url.pathname.startsWith(API_PREFIX + '/') && url.pathname !== API_PREFIX) return serveStatic(req, res, url)

    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') return sendError(res, 405, 'method_not_allowed', 'CORS is not supported')
    const sub = url.pathname.slice(API_PREFIX.length)
    const ctx: RequestCtx = { req, res, params: [], url }
    try {
      const session = tokens.verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE])
      ctx.session = session
      if (sub === '/events' && req.method === 'GET') {
        if (!session) throw new HttpError(401, 'unauthenticated', 'Not paired with this repobs instance')
        return handleEvents(ctx)
      }
      const route = routes.find((r) => {
        if (r.method !== req.method) return false
        const m = r.pattern.exec(sub)
        if (m) ctx.params = m.slice(1)
        return !!m
      })
      if (!route) {
        const exists = routes.some((r) => r.pattern.test(sub))
        throw new HttpError(exists ? 405 : 404, exists ? 'method_not_allowed' : 'not_found', exists ? 'Method not allowed' : 'Not found')
      }
      const mutating = req.method !== 'GET' && req.method !== 'HEAD'
      if (mutating && !req.headers.origin) throw new HttpError(403, 'origin_required', 'State-changing requests must carry an Origin header')
      if (route.auth) {
        if (!session) throw new HttpError(401, 'unauthenticated', 'Not paired with this repobs instance')
        if (mutating && !tokens.verifyCsrf(session.nonce, req.headers[CSRF_HEADER] as string | undefined)) {
          throw new HttpError(403, 'csrf_failed', 'Missing or invalid CSRF token')
        }
      }
      if (mutating && req.method !== 'DELETE') ctx.body = await readJson(req, route.maxBody ?? 256 * 1024)
      const result = await route.handler(ctx)
      if (!res.headersSent) sendJson(res, res.statusCode === 201 ? 201 : 200, result)
    } catch (err) {
      if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message)
      app.log('error', `Unhandled API error on ${req.method} ${sub}: ${(err as Error).message}`)
      sendError(res, 500, 'internal_error', 'Internal error')
    }
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}
