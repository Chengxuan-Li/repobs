import { describe, expect, it } from 'vitest'
import { PICKER_ARGS, parsePickerResult, pickFolder } from '../../apps/server/src/platform/folderPicker.ts'
import type { RunOptions, RunResult } from '../../apps/server/src/platform/process.ts'
import { SpawnError } from '../../apps/server/src/platform/process.ts'

// The native dialog itself cannot run in automated tests; these cover how its process result is
// read. Every outcome must be either a path, an explicit cancel or an error, never a silent no-op.

function result(over: Partial<RunResult> & { out?: string } = {}): RunResult {
  return { code: 0, stdout: Buffer.from(over.out ?? '', 'utf8'), stderr: '', timedOut: false, truncated: false, ...over }
}

const run = (r: RunResult | Error) => async () => {
  if (r instanceof Error) throw r
  return r
}

describe('folder picker result', () => {
  it('returns the chosen folder, including non-ASCII paths', () => {
    expect(parsePickerResult(result({ out: 'selected\nC:\\src\\café projekt' }))).toEqual({ path: 'C:\\src\\café projekt', cancelled: false })
  })

  it('reports an explicit cancel as cancelled', () => {
    expect(parsePickerResult(result({ out: 'cancelled' }))).toEqual({ cancelled: true })
  })

  it('treats a clean exit without a status line as a failure, not a cancel', () => {
    expect(() => parsePickerResult(result({ out: '' }))).toThrow(expect.objectContaining({ code: 'picker_failed', message: 'The folder picker failed without a result' }))
  })

  it('reports a non-zero exit with the first readable error line, from plain or CLIXML stderr', () => {
    expect(() => parsePickerResult(result({ code: 1, stderr: 'Add-Type : compile error\r\nAt line:2\r\n' }))).toThrow(
      expect.objectContaining({ code: 'picker_failed', message: 'The folder picker failed (exit code 1): Add-Type : compile error' }),
    )
    const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Exception calling "Pick": "Access denied"_x000D__x000A_</S><S S="Error">At line:3_x000D__x000A_</S></Objs>'
    expect(() => parsePickerResult(result({ code: 1, stderr: clixml }))).toThrow(
      expect.objectContaining({ message: 'The folder picker failed (exit code 1): Exception calling "Pick": "Access denied"' }),
    )
  })

  it('reports a timeout even if the process wrote a status line', () => {
    expect(() => parsePickerResult(result({ code: null, timedOut: true, out: 'cancelled' }))).toThrow(expect.objectContaining({ code: 'picker_timeout' }))
  })
})

describe('pickFolder', () => {
  it('runs a fixed encoded PowerShell script in an STA thread, without a shell or user input', async () => {
    let seen: { command: string; args: readonly string[]; options: RunOptions } | undefined
    const signal = new AbortController().signal
    await pickFolder({
      platform: 'win32',
      signal,
      run: async (command, args, options) => {
        seen = { command, args, options }
        return result({ out: 'cancelled' })
      },
    })
    expect(seen?.command).toBe('powershell.exe')
    expect(seen?.args).toBe(PICKER_ARGS)
    expect(seen?.args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand'])
    expect(seen?.options.signal).toBe(signal)
    const script = Buffer.from(PICKER_ARGS[4]!, 'base64').toString('utf16le')
    expect(script).toContain('FOS_PICKFOLDERS')
    expect(script).toContain("[RepobsFolderPicker]::Pick('Select a Git repository folder to observe with repobs')")
  })

  it('is unsupported off Windows', async () => {
    await expect(pickFolder({ platform: 'linux', run: run(result({ out: 'cancelled' })) })).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('refuses a second picker while one is open, and frees the slot afterwards', async () => {
    let finish!: (r: RunResult) => void
    const first = pickFolder({ platform: 'win32', run: () => new Promise((resolve) => (finish = resolve)) })
    await expect(pickFolder({ platform: 'win32', run: run(result({ out: 'cancelled' })) })).rejects.toMatchObject({ code: 'busy' })
    finish(result({ out: 'selected\nD:\\repo' }))
    await expect(first).resolves.toEqual({ path: 'D:\\repo', cancelled: false })
    await expect(pickFolder({ platform: 'win32', run: run(result({ out: 'cancelled' })) })).resolves.toEqual({ cancelled: true })
  })

  it('maps a cancelled request and a failed start to distinct errors and frees the slot', async () => {
    await expect(pickFolder({ platform: 'win32', run: run(new SpawnError('aborted', 'Cancelled')) })).rejects.toMatchObject({ code: 'aborted' })
    await expect(pickFolder({ platform: 'win32', run: run(new SpawnError('not_found', 'powershell.exe was not found on PATH')) })).rejects.toMatchObject({
      code: 'picker_failed',
      message: 'The folder picker could not start: powershell.exe was not found on PATH',
    })
    await expect(pickFolder({ platform: 'win32', run: run(result({ out: 'cancelled' })) })).resolves.toEqual({ cancelled: true })
  })
})
