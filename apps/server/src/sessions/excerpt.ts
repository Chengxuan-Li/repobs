import type { LastMessage } from '@repobs/contracts'

// Latest-message excerpts (ADR 0003): mechanical, truncated, with obvious secrets redacted. They
// live in memory only and are never written to the database, logs or exports.

export const EXCERPT_CHARS = 280

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]'],
  [/\b(?:sk|pk|rk)-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g, '[redacted key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted token]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 [redacted]'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, '$1$2[redacted]'],
]

export function redactSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

export function makeExcerpt(kind: LastMessage['kind'], raw: string, at?: string): LastMessage | undefined {
  // Redact before truncating so a secret cut in half is still caught.
  const collapsed = redactSecrets(raw.slice(0, 4_000)).replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  const text = collapsed.length > EXCERPT_CHARS ? collapsed.slice(0, EXCERPT_CHARS - 1).trimEnd() + '…' : collapsed
  return { kind, text, at }
}

/** "Bash: Run the unit tests" from a tool name and the tool's own description field, if any. */
export function toolExcerpt(name: unknown, input: unknown, at?: string): LastMessage | undefined {
  if (typeof name !== 'string' || !name) return undefined
  const desc =
    input && typeof input === 'object' && !Array.isArray(input)
      ? ((input as Record<string, unknown>).description ?? (input as Record<string, unknown>).prompt)
      : undefined
  return makeExcerpt('tool', typeof desc === 'string' && desc ? `${name}: ${desc}` : name, at)
}
