import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlCursor, splitLines } from '../../apps/server/src/sessions/jsonl.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

const dirs: string[] = []
const tmpFile = () => {
  const d = makeTempDir('jsonl')
  dirs.push(d)
  return path.join(d, 'x.jsonl')
}
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!)
})

const collect = async (cursor: JsonlCursor) => {
  const recs: unknown[] = []
  const stats = await cursor.read((r) => recs.push(r))
  return { recs, stats }
}

describe('JsonlCursor', () => {
  it('returns undefined for a missing file', async () => {
    expect(await new JsonlCursor(path.join(makeTempDir('none'), 'missing.jsonl')).read(() => {})).toBeUndefined()
  })

  it('holds a partially written line until it is completed', async () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"a":1}\n{"b":')
    const cursor = new JsonlCursor(file)
    expect((await collect(cursor)).recs).toEqual([{ a: 1 }])
    fs.appendFileSync(file, '2}\n{"c":3}\n')
    expect((await collect(cursor)).recs).toEqual([{ b: 2 }, { c: 3 }])
    expect((await collect(cursor)).recs).toEqual([])
  })

  it('keeps multi-byte UTF-8 characters intact across write boundaries', async () => {
    const file = tmpFile()
    const line = Buffer.from(JSON.stringify({ t: 'ü€😀 path' }) + '\n', 'utf8')
    fs.writeFileSync(file, line.subarray(0, 9))
    const cursor = new JsonlCursor(file)
    expect((await collect(cursor)).recs).toEqual([])
    fs.appendFileSync(file, line.subarray(9))
    expect((await collect(cursor)).recs).toEqual([{ t: 'ü€😀 path' }])
  })

  it('counts invalid lines without throwing', async () => {
    const file = tmpFile()
    fs.writeFileSync(file, 'not json\n{"ok":true}\n\n')
    const { recs, stats } = await collect(new JsonlCursor(file))
    expect(recs).toEqual([{ ok: true }])
    expect(stats!.badLines).toBe(1)
  })

  it('resets after truncation', async () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{"a":1}\n{"a":2}\n')
    const cursor = new JsonlCursor(file)
    await collect(cursor)
    fs.writeFileSync(file, '{"z":1}\n')
    const { recs, stats } = await collect(cursor)
    expect(stats!.reset).toBe(true)
    expect(recs).toEqual([{ z: 1 }])
  })

  it('reads only a bounded head and tail of a large file', async () => {
    const file = tmpFile()
    const big = Array.from({ length: 20_000 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(40) })).join('\n') + '\n'
    fs.writeFileSync(file, big)
    const head: unknown[] = []
    const tail: Array<{ i: number }> = []
    const cursor = new JsonlCursor(file, { headBytes: 1024, tailBytes: 4096 })
    const stats = await cursor.read((r) => tail.push(r as { i: number }), (r) => head.push(r))
    expect(stats!.jumped).toBe(true)
    expect(head.length).toBeGreaterThan(0)
    expect(head.length).toBeLessThan(30)
    expect(tail.length).toBeLessThan(100)
    expect(tail.at(-1)!.i).toBe(19_999)
  })
})

describe('splitLines', () => {
  it('handles CRLF and trailing partial data', () => {
    const { complete, partial } = splitLines(Buffer.from('a\r\nb\nc'), true)
    expect(complete.map(String)).toEqual(['a', 'b'])
    expect(String(partial)).toBe('c')
  })
})
