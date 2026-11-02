import fs from 'node:fs'
import zlib from 'node:zlib'
import { DEFAULT_LIMITS, splitLines } from './jsonl.ts'

// Bounded reading of zstd-compressed JSONL (Codex compresses older rollouts in place, ADR 0012).
// A compressed file cannot be read from its end, so it is decompressed as a stream and nothing is
// written anywhere. Like a large plain file, the caller gets the records of a bounded head (session
// metadata) and a bounded tail (the latest state); lines in between are not parsed, except the
// latest few that contain one of `markers`, which are returned for the caller to replay.

export const zstdAvailable = typeof zlib.createZstdDecompress === 'function'

export const COMPRESSED_LIMITS = {
  headBytes: DEFAULT_LIMITS.headBytes,
  tailBytes: DEFAULT_LIMITS.tailBytes,
  maxLineBytes: DEFAULT_LIMITS.maxLineBytes,
  /** Decompressed bytes per file; beyond this only the head is used. */
  maxBytes: 1024 * 1024 * 1024,
  /** Marker lines kept from before the tail. */
  keepMarked: 16,
}

export type CompressedLimits = typeof COMPRESSED_LIMITS

export interface CompressedReadStats {
  records: number
  badLines: number
  skippedLongLines: number
  /** Decompressed bytes seen (up to the limit). */
  bytes: number
  /** The limit was reached: only the head was fed. */
  tooLarge: boolean
  /** Lines between head and tail were skipped. */
  jumped: boolean
  /** Parsed records of the latest marker lines before the tail, in file order. */
  marked: unknown[]
}

export async function readCompressedJsonl(
  file: string,
  onRecord: (rec: unknown) => void,
  onHead?: (rec: unknown) => void,
  markers: string[] = [],
  limits: Partial<CompressedLimits> = {},
): Promise<CompressedReadStats> {
  const lim = { ...COMPRESSED_LIMITS, ...limits }
  const stats: CompressedReadStats = { records: 0, badLines: 0, skippedLongLines: 0, bytes: 0, tooLarge: false, jumped: false, marked: [] }
  const headParts: Buffer[] = []
  let headLen = 0
  const window: Buffer[] = []
  let windowLen = 0
  // Partial line carried across dropped chunks, for the marker search.
  let carry: Buffer = Buffer.alloc(0)
  let carryOverflow = false
  const marked: Buffer[] = []
  const needles = markers.map((m) => Buffer.from(m))

  const keepMarked = (line: Buffer) => {
    if (line.length > lim.maxLineBytes) return
    marked.push(Buffer.from(line))
    if (marked.length > lim.keepMarked) marked.shift()
  }

  // Search a dropped region for marker lines; the part after its last LF is carried over.
  const scanDropped = (chunk: Buffer) => {
    if (!needles.length) return
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk
    const lastLf = data.lastIndexOf(0x0a)
    if (lastLf >= 0) {
      const body = data.subarray(0, lastLf)
      const starts = new Set<number>()
      for (const needle of needles) {
        let at = body.indexOf(needle)
        while (at >= 0) {
          const start = body.lastIndexOf(0x0a, at) + 1
          const end = body.indexOf(0x0a, at)
          starts.add(start)
          at = end < 0 ? -1 : body.indexOf(needle, end)
        }
      }
      // A line continued from an overflowed carry is incomplete: skip it.
      for (const start of [...starts].sort((a, b) => a - b)) {
        if (start === 0 && carryOverflow) continue
        const end = body.indexOf(0x0a, start)
        keepMarked(body.subarray(start, end < 0 ? body.length : end))
      }
      carryOverflow = false
    }
    const rest = lastLf >= 0 ? data.subarray(lastLf + 1) : data
    if (rest.length > lim.maxLineBytes) {
      carry = Buffer.alloc(0)
      carryOverflow = true
    } else {
      carry = Buffer.from(rest)
    }
  }

  const source = fs.createReadStream(file)
  const decompress = zlib.createZstdDecompress()
  source.on('error', (err) => decompress.destroy(err))
  source.pipe(decompress)
  try {
    for await (const chunk of decompress as AsyncIterable<Buffer>) {
      stats.bytes += chunk.length
      if (stats.bytes > lim.maxBytes) {
        stats.tooLarge = true
        break
      }
      if (headLen < lim.headBytes) {
        const part = chunk.subarray(0, lim.headBytes - headLen)
        headParts.push(Buffer.from(part))
        headLen += part.length
      }
      window.push(chunk)
      windowLen += chunk.length
      while (window.length > 1 && windowLen - window[0]!.length >= lim.tailBytes) {
        const dropped = window.shift()!
        windowLen -= dropped.length
        stats.jumped = true
        scanDropped(dropped)
      }
    }
  } finally {
    source.destroy()
    decompress.destroy()
  }

  const parse = (line: Buffer, feed: (rec: unknown) => void) => {
    if (line.length === 0) return
    if (line.length > lim.maxLineBytes) {
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
    feed(rec)
  }

  if (onHead) {
    const head = Buffer.concat(headParts)
    for (const line of splitLines(head, stats.bytes > head.length || stats.tooLarge).complete) parse(line, onHead)
  }
  if (stats.tooLarge) return stats

  let tail = Buffer.concat(window)
  if (tail.length > lim.tailBytes) {
    // Chunks are coarse: cut the window to the bound, as for a plain file.
    scanDropped(tail.subarray(0, tail.length - lim.tailBytes))
    tail = tail.subarray(tail.length - lim.tailBytes)
    stats.jumped = true
  }
  if (stats.jumped) {
    // The first line of the window started in a dropped chunk.
    const firstLf = tail.indexOf(0x0a)
    const boundary = Buffer.concat([carry, tail.subarray(0, firstLf < 0 ? tail.length : firstLf)])
    if (!carryOverflow && needles.some((n) => boundary.includes(n))) keepMarked(boundary)
    tail = firstLf < 0 ? Buffer.alloc(0) : tail.subarray(firstLf + 1)
  }
  for (const line of splitLines(tail, false).complete) parse(line, onRecord)

  for (const line of marked) {
    try {
      stats.marked.push(JSON.parse(line.toString('utf8')))
    } catch {
      // A marker inside a line that is not a record; ignore.
    }
  }
  return stats
}
