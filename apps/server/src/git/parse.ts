// Parsers for NUL-delimited Git porcelain output. They are pure functions over Buffers/strings so
// they can be tested with synthetic output containing spaces, Unicode and newlines in paths.

export interface RawWorktree {
  path: string
  head?: string
  branch?: string
  detached: boolean
  bare: boolean
  locked: boolean
  lockReason?: string
  prunable: boolean
  prunableReason?: string
}

/** `git worktree list --porcelain -z`: attributes end with NUL, records end with an extra NUL. */
export function parseWorktreeList(output: Buffer | string): RawWorktree[] {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const result: RawWorktree[] = []
  let current: RawWorktree | undefined
  for (const field of text.split('\0')) {
    if (field === '') {
      if (current) result.push(current)
      current = undefined
      continue
    }
    const space = field.indexOf(' ')
    const key = space === -1 ? field : field.slice(0, space)
    const value = space === -1 ? undefined : field.slice(space + 1)
    if (key === 'worktree') {
      if (current) result.push(current)
      current = { path: value ?? '', detached: false, bare: false, locked: false, prunable: false }
      continue
    }
    if (!current) continue
    switch (key) {
      case 'HEAD':
        current.head = value
        break
      case 'branch':
        current.branch = value
        break
      case 'detached':
        current.detached = true
        break
      case 'bare':
        current.bare = true
        break
      case 'locked':
        current.locked = true
        if (value) current.lockReason = value
        break
      case 'prunable':
        current.prunable = true
        if (value) current.prunableReason = value
        break
      default:
        // Unknown attributes from newer Git versions are ignored.
        break
    }
  }
  if (current) result.push(current)
  return result
}

export interface RawStatus {
  oid?: string
  /** `(initial)` when the branch is unborn. */
  unborn: boolean
  head?: string
  detached: boolean
  upstream?: string
  ahead?: number
  behind?: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  ignored: number
}

/** `git status --porcelain=v2 --branch -z`. */
export function parseStatusV2(output: Buffer | string): RawStatus {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const status: RawStatus = {
    unborn: false,
    detached: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    ignored: 0,
  }
  const fields = text.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!
    if (f === '') continue
    if (f.startsWith('# ')) {
      const [, key, ...rest] = f.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') {
        if (value === '(initial)') status.unborn = true
        else status.oid = value
      } else if (key === 'branch.head') {
        if (value === '(detached)') status.detached = true
        else status.head = value
      } else if (key === 'branch.upstream') {
        status.upstream = value
      } else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = f[0]
    if (kind === '1' || kind === '2') {
      const xy = f.slice(2, 4)
      if (xy[0] !== '.') status.staged++
      if (xy[1] !== '.') status.unstaged++
      // A rename/copy record is followed by its original path as a separate NUL field.
      if (kind === '2') i++
    } else if (kind === 'u') {
      status.conflicted++
    } else if (kind === '?') {
      status.untracked++
    } else if (kind === '!') {
      status.ignored++
    }
  }
  return status
}

export interface RawRef {
  refname: string
  objectname: string
  upstream?: string
  track?: string
  worktreePath?: string
  symref?: string
}

/** Output of `for-each-ref --format=REF_FORMAT`: six NUL-terminated fields, then a newline. */
export function parseRefs(output: Buffer | string): RawRef[] {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const tokens = text.split('\0')
  const refs: RawRef[] = []
  for (let i = 0; i + 5 < tokens.length; i += 6) {
    const refname = tokens[i]!.replace(/^\n/, '')
    if (!refname) continue
    const ref: RawRef = { refname, objectname: tokens[i + 1]! }
    if (tokens[i + 2]) ref.upstream = tokens[i + 2]
    if (tokens[i + 3]) ref.track = tokens[i + 3]
    if (tokens[i + 4]) ref.worktreePath = tokens[i + 4]
    if (tokens[i + 5]) ref.symref = tokens[i + 5]
    refs.push(ref)
  }
  return refs
}

/** `%(upstream:track,nobracket)`: "", "gone", "ahead 1", "behind 2", "ahead 1, behind 2". */
export function parseTrack(track: string | undefined): { gone: boolean; ahead?: number; behind?: number } {
  if (!track) return { gone: false, ahead: 0, behind: 0 }
  if (track.trim() === 'gone') return { gone: true }
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { gone: false, ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 }
}

/** `git remote -v` lines: "<name>\t<url> (fetch|push)". */
export function parseRemotes(output: Buffer | string): Array<{ name: string; url: string }> {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const seen = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\t(\S+) \(fetch\)$/.exec(line)
    if (m && !seen.has(m[1]!)) seen.set(m[1]!, m[2]!)
  }
  return [...seen].map(([name, url]) => ({ name, url }))
}
