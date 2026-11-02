import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Windows-aware path identity. We keep two forms of each path: a display form (native separators,
// upper-case drive letter) and a comparison key (display form, lower-cased on case-insensitive
// platforms). Repositories, worktrees and session cwds are matched by key with path boundaries.

const isWindows = process.platform === 'win32'

/** Strip Win32 namespace prefixes (\\?\C:\x, \\?\UNC\server\share) that some tools emit. */
export function stripNamespace(p: string): string {
  if (p.startsWith('\\\\?\\UNC\\')) return '\\\\' + p.slice(8)
  if (p.startsWith('\\\\?\\') || p.startsWith('//?/')) return p.slice(4)
  return p
}

export function toDisplayPath(input: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    let p = stripNamespace(input.trim())
    // Git for Windows prints forward slashes; MSYS-style /d/x paths are not produced by git.exe.
    p = path.win32.normalize(p.replace(/\//g, '\\'))
    if (/^[a-z]:/.test(p)) p = p[0]!.toUpperCase() + p.slice(1)
    if (p.length > 3 && p.endsWith('\\')) p = p.slice(0, -1)
    return p
  }
  let p = path.posix.normalize(input.trim())
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

export function pathKey(input: string, platform: NodeJS.Platform = process.platform): string {
  const display = toDisplayPath(input, platform)
  return platform === 'win32' || platform === 'darwin' ? display.toLowerCase() : display
}

/** Canonical display path, resolving symlinks/junctions when the path exists. */
export function canonicalPath(input: string): string {
  const display = toDisplayPath(input)
  try {
    return toDisplayPath(fs.realpathSync.native(display))
  } catch {
    return display
  }
}

const realpathCache = new Map<string, { value: string; at: number }>()

/** canonicalPath with a short-lived cache, for hot paths such as session cwd matching. */
export function canonicalPathCached(input: string, ttlMs = 30_000): string {
  const key = pathKey(input)
  const hit = realpathCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < ttlMs) return hit.value
  const value = canonicalPath(input)
  if (realpathCache.size > 5_000) realpathCache.clear()
  realpathCache.set(key, { value, at: now })
  return value
}

/** True when `child` equals `root` or lies inside it (separator boundary aware). */
export function isWithin(child: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const c = pathKey(child, platform)
  const r = pathKey(root, platform)
  if (c === r) return true
  const sep = platform === 'win32' ? '\\' : '/'
  const prefix = r.endsWith(sep) ? r : r + sep
  return c.startsWith(prefix)
}

export function basenameOf(p: string): string {
  const display = toDisplayPath(p)
  return (isWindows ? path.win32.basename(display) : path.posix.basename(display)) || display
}

/** Replace the user's home directory with `~` for diagnostics and logs. */
export function redactHome(p: string): string {
  const home = os.homedir()
  if (home && isWithin(p, home)) {
    const display = toDisplayPath(p)
    return '~' + display.slice(toDisplayPath(home).length)
  }
  return p
}

export function isAbsoluteLocalPath(p: string): boolean {
  if (p.includes('\0')) return false
  if (isWindows) {
    const s = stripNamespace(p)
    // Drive-absolute only; UNC/network shares are out of scope for v1 (local-first).
    return /^[A-Za-z]:[\\/]/.test(s)
  }
  return path.posix.isAbsolute(p)
}
