import { z } from 'zod'
import { LIMITS } from './domain.ts'

export const ThemePreference = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof ThemePreference>

const OptionalPath = z.string().trim().max(LIMITS.pathChars).nullable()

export const Settings = z.object({
  theme: ThemePreference,
  adapters: z.object({
    claude: z.object({ enabled: z.boolean(), home: OptionalPath }),
    codex: z.object({ enabled: z.boolean(), home: OptionalPath }),
  }),
  monitoring: z.object({
    /** Status poll for worktrees with recent changes. */
    activeWorktreePollMs: z.number().int().min(1_000).max(600_000),
    /** Status poll for quiet worktrees. */
    idleWorktreePollMs: z.number().int().min(5_000).max(3_600_000),
    sessionPollMs: z.number().int().min(1_000).max(600_000),
    /** Watch working files recursively (one OS handle per worktree on Windows). */
    watchWorkingTrees: z.boolean(),
  }),
  status: z.object({
    /** Inferred "running"/"waiting" evidence older than this becomes unknown. */
    staleAfterMinutes: z.number().int().min(1).max(1_440),
    /** Sessions without activity for this long are shown as historical. */
    historicalAfterHours: z.number().int().min(1).max(24 * 365),
  }),
  privacy: z.object({
    /** Show truncated, redacted excerpts of the latest agent message (ADR 0003). Never stored. */
    showMessageExcerpts: z.boolean(),
    /** Read the step lists agents keep with their planning tools (ADR 0009); in memory only. */
    readAgentPlans: z.boolean(),
    /** Read agents' steps, tool categories and token counts on demand (ADR 0013); in memory only. */
    readAgentActivity: z.boolean(),
  }),
  github: z.object({
    /** Opt-in: read open pull requests with the GitHub CLI. Off by default. */
    enabled: z.boolean(),
    pollMinutes: z.number().int().min(1).max(1_440),
  }),
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  adapters: {
    claude: { enabled: true, home: null },
    codex: { enabled: true, home: null },
  },
  monitoring: {
    activeWorktreePollMs: 5_000,
    idleWorktreePollMs: 30_000,
    sessionPollMs: 4_000,
    watchWorkingTrees: true,
  },
  status: { staleAfterMinutes: 30, historicalAfterHours: 24 },
  privacy: { showMessageExcerpts: true, readAgentPlans: true, readAgentActivity: true },
  github: { enabled: false, pollMinutes: 10 },
}

/** Deep-partial PATCH body. */
export const SettingsPatch = z.object({
  theme: ThemePreference.optional(),
  adapters: z
    .object({
      claude: z.object({ enabled: z.boolean(), home: OptionalPath }).partial().optional(),
      codex: z.object({ enabled: z.boolean(), home: OptionalPath }).partial().optional(),
    })
    .optional(),
  monitoring: Settings.shape.monitoring.partial().optional(),
  status: Settings.shape.status.partial().optional(),
  privacy: Settings.shape.privacy.partial().optional(),
  github: Settings.shape.github.partial().optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatch>

export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  return Settings.parse({
    theme: patch.theme ?? base.theme,
    adapters: {
      claude: { ...base.adapters.claude, ...patch.adapters?.claude },
      codex: { ...base.adapters.codex, ...patch.adapters?.codex },
    },
    monitoring: { ...base.monitoring, ...patch.monitoring },
    status: { ...base.status, ...patch.status },
    privacy: { ...base.privacy, ...patch.privacy },
    github: { ...base.github, ...patch.github },
  })
}
