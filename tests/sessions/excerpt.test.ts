import { describe, expect, it } from 'vitest'
import { EXCERPT_CHARS, makeExcerpt, redactSecrets, toolExcerpt } from '../../apps/server/src/sessions/excerpt.ts'

describe('latest-message excerpts', () => {
  it('collapses whitespace and truncates', () => {
    const e = makeExcerpt('assistant', 'line one\n\n  line two\t' + 'x'.repeat(1000))!
    expect(e.text.startsWith('line one line two')).toBe(true)
    expect(e.text.length).toBe(EXCERPT_CHARS)
    expect(e.text.endsWith('…')).toBe(true)
    expect(makeExcerpt('assistant', '   \n ')).toBeUndefined()
  })

  it.each([
    ['sk-proj-abcdefghijklmnopqrstuvwx', 'abcdefghijklmnopqrstuvwx'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'abcdefghijklmnopqrstuvwxyz0123'],
    ['AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlc2ln', 'c2lnbmF0dXJlc2ln'],
    ['password=hunter2hunter2', 'hunter2'],
    ['Authorization: Bearer abcdefghijklmnop.qrstuv', 'abcdefghijklmnop'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretbody\n-----END RSA PRIVATE KEY-----', 'MIIEsecretbody'],
  ])('redacts %s', (secret, mustNotAppear) => {
    const out = redactSecrets(`before ${secret} after`)
    expect(out).not.toContain(mustNotAppear)
    expect(out).toContain('before')
    expect(out).toContain('redacted')
  })

  it('keeps ordinary text and commit hashes', () => {
    expect(redactSecrets('Merged 3f2a1b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90 into main')).toContain('3f2a1b9c')
  })

  it('describes tool activity with the tool description', () => {
    expect(toolExcerpt('Bash', { command: 'npm test', description: 'Run the unit tests' })).toMatchObject({ kind: 'tool', text: 'Bash: Run the unit tests' })
    expect(toolExcerpt('Read', { file_path: 'x' })?.text).toBe('Read')
    expect(toolExcerpt(undefined, {})).toBeUndefined()
  })
})
