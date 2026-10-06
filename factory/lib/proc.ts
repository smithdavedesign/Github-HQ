import { spawn } from 'node:child_process'

export interface ProcResult {
  code: number | null
  /** Combined stdout+stderr, truncated to the last `maxOutput` chars. */
  output: string
  durationMs: number
  timedOut: boolean
}

export interface ProcOptions {
  cwd?: string
  /**
   * Variables to set on top of the inherited environment. Overrides only: the sandbox
   * runner forwards exactly these into the container, never the host's environment.
   */
  env?: Record<string, string | undefined>
  timeoutMs?: number
  input?: string
  maxOutput?: number
}

/** Runs a command somewhere: on the host (`run`) or inside a sandbox container (sandbox.ts). */
export type Runner = (cmd: string, args: string[], opts?: ProcOptions) => Promise<ProcResult>

/** Run a command without a shell; never throws on non-zero exit. */
export function run(cmd: string, args: string[], opts: ProcOptions = {}): Promise<ProcResult> {
  const { cwd, env, timeoutMs = 10 * 60_000, input, maxOutput = 20_000 } = opts
  const started = Date.now()
  return new Promise(resolve => {
    let out = ''
    let timedOut = false
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    const append = (b: Buffer) => {
      out += b.toString()
      if (out.length > maxOutput * 2) out = out.slice(-maxOutput)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      // Kill the whole process group — npm/npx spawn grandchildren.
      try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }, timeoutMs)
    child.on('error', err => {
      clearTimeout(timer)
      resolve({ code: null, output: `${out}\n${err.message}`.slice(-maxOutput), durationMs: Date.now() - started, timedOut })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, output: out.slice(-maxOutput), durationMs: Date.now() - started, timedOut })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}
