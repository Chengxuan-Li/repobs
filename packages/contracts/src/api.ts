import { z } from 'zod'
import { ErrorInfo, LIMITS, ReviewState, SessionAnnotation, ChecklistItem, IsoDate } from './domain.ts'

export const API_PREFIX = '/api/v1'
export const CSRF_HEADER = 'x-repobs-csrf'
export const SESSION_COOKIE = 'repobs_session'

export const ApiError = z.object({ error: ErrorInfo })
export type ApiError = z.infer<typeof ApiError>

export const Health = z.object({
  ok: z.literal(true),
  name: z.literal('repobs'),
  version: z.string(),
  monitor: z.enum(['starting', 'ok', 'degraded']),
})
export type Health = z.infer<typeof Health>

export const PairRequest = z.object({ token: z.string().min(10).max(512) })
export const AuthSession = z.object({ csrfToken: z.string(), expiresAt: IsoDate })
export type AuthSession = z.infer<typeof AuthSession>

export const RegisterRepositoryRequest = z.object({
  path: z.string().trim().min(1).max(LIMITS.pathChars),
  displayName: z.string().trim().min(1).max(120).optional(),
})
export type RegisterRepositoryRequest = z.infer<typeof RegisterRepositoryRequest>

export const RegisterRepositoriesRequest = z.object({
  paths: z.array(z.string().trim().min(1).max(LIMITS.pathChars)).min(1).max(50),
})
export type RegisterRepositoriesRequest = z.infer<typeof RegisterRepositoriesRequest>

export const RegisterRepositoriesResponse = z.object({
  results: z.array(
    z.object({
      path: z.string(),
      ok: z.boolean(),
      repositoryId: z.string().optional(),
      error: ErrorInfo.optional(),
    }),
  ),
})
export type RegisterRepositoriesResponse = z.infer<typeof RegisterRepositoriesResponse>

export const UpdateRepositoryRequest = z.object({
  displayName: z.string().trim().min(1).max(120),
})

export const ReorderRepositoriesRequest = z.object({
  ids: z.array(z.string().max(128)).max(500),
})

export const RepositorySuggestion = z.object({
  path: z.string(),
  source: z.enum(['claude', 'codex']),
  sessionCount: z.number().int(),
  activeSessionCount: z.number().int(),
  lastActivityAt: IsoDate.optional(),
})
export type RepositorySuggestion = z.infer<typeof RepositorySuggestion>

export const PickDirectoryResponse = z.object({
  path: z.string().optional(),
  cancelled: z.boolean(),
})

/** Annotation PUT body: the server stamps ids/timestamps it owns. */
export const AnnotationInput = z.object({
  displayAlias: z.string().trim().max(LIMITS.aliasChars).optional(),
  review: ReviewState,
  tags: z.array(z.string().trim().min(1).max(LIMITS.tagChars)).max(LIMITS.tags),
  note: z.string().max(LIMITS.noteChars),
  checklist: z
    .array(
      ChecklistItem.extend({
        createdAt: IsoDate.optional(),
      }),
    )
    .max(LIMITS.checklistItems),
})
export type AnnotationInput = z.infer<typeof AnnotationInput>

export const AnnotationExport = z.object({
  format: z.literal('repobs-annotations'),
  version: z.literal(1),
  exportedAt: IsoDate,
  annotations: z.array(SessionAnnotation).max(100_000),
})
export type AnnotationExport = z.infer<typeof AnnotationExport>

export const ImportResult = z.object({ imported: z.number().int(), skipped: z.number().int() })

export const AdapterDiagnostics = z.object({
  provider: z.enum(['claude', 'codex']),
  enabled: z.boolean(),
  available: z.boolean(),
  /** Root with the user's home directory shown as `~`. */
  root: z.string(),
  rootSource: z.enum(['settings', 'environment', 'default']),
  filesTracked: z.number().int(),
  sessionsDiscovered: z.number().int(),
  sessionsInRegisteredRepos: z.number().int(),
  liveRegistryEntries: z.number().int().optional(),
  lastScanAt: IsoDate.optional(),
  lastScanMs: z.number().optional(),
  watching: z.boolean(),
  /** Sanitized messages; never transcript text. */
  problems: z.array(z.object({ code: z.string(), message: z.string(), count: z.number().int() })),
})
export type AdapterDiagnostics = z.infer<typeof AdapterDiagnostics>

export const Diagnostics = z.object({
  version: z.string(),
  startedAt: IsoDate,
  dataDir: z.string(),
  git: z.object({ available: z.boolean(), version: z.string().optional(), error: z.string().optional() }),
  database: z.object({
    path: z.string(),
    schemaVersion: z.number().int(),
    recoveredFromCorruption: z.string().optional(),
  }),
  monitor: z.object({
    state: z.enum(['starting', 'ok', 'degraded']),
    lastSyncAt: IsoDate.optional(),
    watchers: z.number().int(),
    watcherErrors: z.number().int(),
    pollIntervalsMs: z.record(z.string(), z.number()),
    snapshotVersion: z.number().int(),
    sseClients: z.number().int(),
  }),
  adapters: z.array(AdapterDiagnostics),
  github: z.object({ enabled: z.boolean(), lastRunAt: IsoDate.optional(), error: z.string().optional() }),
})
export type Diagnostics = z.infer<typeof Diagnostics>
