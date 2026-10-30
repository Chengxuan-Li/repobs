import fs from 'node:fs/promises'

// Incremental, bounded JSONL reading. Provider transcripts can be tens of megabytes, so we never
// reread a whole file per poll: the first read takes a bounded head (for session metadata) and a
// bounded tail (for the latest state); later reads take only appended bytes. Lines are split on
// 0x0A bytes, which never occur inside a UTF-8 multi-byte sequence, so decoding is boundary-safe.

export const DEFAULT_LIMITS = {
  headBytes: 256 * 1024,
  tailBytes: 512 * 1024,
  maxAppendBytes: 4 * 1024 * 1024,
  maxLineBytes: 4 * 1024 * 1024,
}

export type JsonlLimits = typeof DEFAULT_LIMITS

export interface ReadStats {
  records: number
  badLines: number
  skippedLongLines: number
  reset: boolean
  jumped: boolean
}

export class JsonlCursor {
  readonly file: string
  private offset = 0
  private remainder: Buffer = Buffer.alloc(0)
  private identity = ''
  private readonly limits: JsonlLimits
  private headDone = false

  constructor(file: string, limits: Partial<JsonlLimits> = {}) {
    this.file = file
    this.limits = { ...DEFAULT_LIMITS, ...limits }
  }

  get position(): number {
    return this.offset
  }

  /**
   * Read what is new since the last call and feed parsed records to `onRecord`. `onHead` receives
   * records from the head of the file on the first read (or after truncation/replacement).
   * Returns undefined when the file does not exist.
   */
  async read(
    onRecord: (rec: unknown) => void,
    onHead?: (rec: unknown) => void,
  ): Promise<ReadStats | undefined> {
    let handle: fs.FileHandle
    try {
      handle = await fs.open(this.file, 'r')
    } catch {
      return undefined
    }
    const stats: ReadStats = { records: 0, badLines: 0, skippedLongLines: 0, reset: false, jumped: false }
    try {
      const st = await handle.stat()
      const identity = `${st.ino}:${st.birthtimeMs}`
      if (this.identity && identity !== this.identity) {
        this.resetState()
        stats.reset = true
      }
      this.identity = identity
      if (st.size < this.offset) {
        // Truncated or rewritten in place.
        this.resetState()
        stats.reset = true
      }
      if (!this.headDone) {
        this.headDone = true
        if (onHead) {
          const headLen = Math.min(st.size, this.limits.headBytes)
          const head = await readRange(handle, 0, headLen)
          const lines = splitLines(head, headLen < st.size)
          for (const line of lines.complete) this.parseLine(line, onHead, stats)
        }
      }
      let start = this.offset
      if (st.size - start > (this.offset === 0 ? this.limits.tailBytes : this.limits.maxAppendBytes)) {
        // Jump to a bounded tail; the first (partial) line after the jump is discarded.
        start = st.size - this.limits.tailBytes
        this.remainder = Buffer.alloc(0)
        stats.jumped = true
      }
      if (st.size > start) {
        const chunk = await readRange(handle, start, st.size - start)
        const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk
        const lines = splitLines(data, true)
        const complete = stats.jumped ? lines.complete.slice(1) : lines.complete
        for (const line of complete) this.parseLine(line, onRecord, stats)
        this.remainder = lines.partial.length <= this.limits.maxLineBytes ? lines.partial : Buffer.alloc(0)
        this.offset = st.size
      }
    } finally {
      await handle.close()
    }
    return stats
  }

  private resetState() {
    this.offset = 0
    this.remainder = Buffer.alloc(0)
    this.headDone = false
  }

  private parseLine(line: Buffer, onRecord: (rec: unknown) => void, stats: ReadStats) {
    if (line.length === 0) return
    if (line.length > this.limits.maxLineBytes) {
      stats.skippedLongLines++
      return
    }
    let rec: unknown
    try {
      rec = JSON.parse(line.toString('utf8'))
    } catch {
      stats.badLines++
      return
    }
    stats.records++
    onRecord(rec)
  }
}

async function readRange(handle: fs.FileHandle, start: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const { bytesRead } = await handle.read(buf, read, length - read, start + read)
    if (bytesRead === 0) break
    read += bytesRead
  }
  return buf.subarray(0, read)
}

/** Split on LF. When `mayBePartial`, bytes after the last LF are returned as `partial`. */
export function splitLines(data: Buffer, mayBePartial: boolean): { complete: Buffer[]; partial: Buffer } {
  const complete: Buffer[] = []
  let start = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0a) {
      let end = i
      if (end > start && data[end - 1] === 0x0d) end--
      complete.push(data.subarray(start, end))
      start = i + 1
    }
  }
  const rest = data.subarray(start)
  if (!mayBePartial && rest.length) return { complete: [...complete, rest], partial: Buffer.alloc(0) }
  return { complete, partial: Buffer.from(rest) }
}

/** Read a small JSON file with a size cap. */
export async function readSmallJson(file: string, maxBytes = 64 * 1024): Promise<unknown> {
  const st = await fs.stat(file)
  if (st.size > maxBytes) throw new Error('file too large')
  return JSON.parse(await fs.readFile(file, 'utf8'))
}
