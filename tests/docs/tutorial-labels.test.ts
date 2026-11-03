import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The tutorial names controls in bold, as they read in the app: **Help → Legend and controls**,
// **Clear filters**. Every such name must still be in the app's source, so renaming or removing
// a control fails here until the tutorial follows (AGENTS.md).

const TUTORIAL = path.resolve('docs/tutorial')
const SOURCES = ['apps/web/src', 'packages/contracts/src'].map((d) => path.resolve(d))

/** Bold text that is not a control's name: keys, marks, counts, and lead-ins ending with a colon or full stop. */
const NOT_A_NAME = [
  /[:.]$/, // "**Pan:** drag the history", "**One row per branch.**"
  /^(Ctrl|Shift|Alt|F\d|Esc|Enter|Tab|Home|End)\b/,
  /^[^A-Za-z]*$/, // −, +, ◆, ○, › 2, 1/3
  /^Next$/,
]

function files(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return files(p, ext)
    return ext.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

/** Each **bold** span of the chapter, outside code blocks, split into the parts of a menu path. */
export function boldNames(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  return [...prose.matchAll(/\*\*([^*]+)\*\*/g)]
    .flatMap((m) => m[1]!.split(/\s+→\s+/))
    .map((s) => s.trim())
    .filter((s) => s && !NOT_A_NAME.some((re) => re.test(s)))
}

describe('the tutorial names controls the app has', () => {
  const source = SOURCES.flatMap((d) => files(d, /\.(ts|tsx)$/))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')
  // Labels are written with typographic apostrophes and ellipses, sometimes as escapes.
  const app = source.replace(/\\u2019/g, '’').replace(/\\u2026/g, '…')

  for (const chapter of fs.readdirSync(TUTORIAL).filter((f) => f.endsWith('.md'))) {
    it(chapter, () => {
      const names = boldNames(fs.readFileSync(path.join(TUTORIAL, chapter), 'utf8'))
      const missing = [...new Set(names)].filter((name) => !app.includes(name))
      expect(missing, `bold names in docs/tutorial/${chapter} not found in the app's source`).toEqual([])
    })
  }

  it('reads menu paths and skips keys, marks and lead-ins', () => {
    expect(boldNames('Use **Help → Legend and controls**, **Ctrl+K**, **−**, **Pan:** and `**code**`.')).toEqual(['Help', 'Legend and controls'])
  })
})
