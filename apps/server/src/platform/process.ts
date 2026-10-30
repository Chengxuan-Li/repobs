import { spawn } from 'node:child_process'

// The only process-spawning primitive in the server. Always argv + shell:false, bounded time and
// output, no stdin. Callers own any further allowlisting (see git/exec.ts).

export interface RunOptions {
  cwd?: string
  timeoutMs: number
  maxOutputBytes: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

export interface RunResult {
  code: number | null
  stdout: Buffer
  stderr: string
  timedOut: boolean
  truncated: boolean
}

export class SpawnError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function runProcess(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    for (const a of args) {
      if (a.includes('\0')) {
        reject(new SpawnError('invalid_argument', 'Argument contains NUL'))
        return
      }
    }
    let child
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: options.signal,
      })
    } catch (err) {
      reject(new SpawnError('spawn_failed', (err as Error).message))
      return
    }
    const out: Buffer[] = []
    let outBytes = 0
    let err = ''
    let truncated = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (outBytes + chunk.length > options.maxOutputBytes) {
        truncated = true
        const room = options.maxOutputBytes - outBytes
        if (room > 0) out.push(chunk.subarray(0, room))
        outBytes = options.maxOutputBytes
        child.kill()
        return
      }
      out.push(chunk)
      outBytes += chunk.length
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 4096) err += chunk.toString('utf8').slice(0, 4096 - err.length)
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (e.code === 'ENOENT') reject(new SpawnError('not_found', `${command} was not found on PATH`))
      else if (e.name === 'AbortError') reject(new SpawnError('aborted', 'Cancelled'))
      else reject(new SpawnError('spawn_failed', e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(out), stderr: err, timedOut, truncated })
    })
  })
}

/** Small bounded-concurrency limiter. */
export function createLimiter(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= concurrency) return
    const job = queue.shift()
    if (job) {
      active++
      job()
    }
  }
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}
