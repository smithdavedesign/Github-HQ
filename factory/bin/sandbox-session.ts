/**
 * One sandbox session for another process on the Mac: idea-factory's milestone builds
 * (docs/idea-factory.md, "Build"). Same hardened sandbox as the factory's own jobs
 * (factory/lib/sandbox.ts): a worker with no mounts, no host environment and no credentials,
 * on a network whose only way out is the egress allowlist.
 *
 *   npx tsx factory/bin/sandbox-session.ts      # then JSON lines on stdin, one reply per line on stdout
 *
 * Requests ({id, op, ...}) and replies ({id, ok, ...} or {id, ok: false, error}):
 *   open  {dir, allowHosts?, allowModels?, lifetimeMs?}  copy the host directory (a git clone) into the worker.
 *         lifetimeMs: how long the worker lives, up to 8 hours (an MVP build runs several milestones).
 *         allowHosts are added to the factory's registries (an idea build adds api.anthropic.com);
 *         allowModels are the LiteLLM aliases the relay may serve (the free pool for a fallback).
 *         → {workdir, relayUrl, modelKey}
 *   put   {path, content}                   write a file in the worker (e.g. outside the workspace)
 *   exec  {cmd, args, env?, cwd?, timeoutMs?} run in the worker; only `env` is passed in
 *         → {code, output, timedOut, durationMs}
 *   patch {exclude?}                        commit the workspace and return `git diff` against the
 *         clone's HEAD at open, binary-safe, as a host file → {file}. node_modules is always excluded.
 *   close                                   remove the containers and exit (also on stdin EOF)
 * Logs go to stderr. Secrets (a Claude token) arrive in `exec` env only and are never logged.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { loadConfig } from '../lib/config'
import { RELAY_URL, SANDBOX_MODEL_KEY, Sandbox, WORKDIR, dockerAvailable, ensureSandboxImages, sweepSandboxes, type SandboxOpenOptions } from '../lib/sandbox'
import type { ProcOptions, ProcResult } from '../lib/proc'

export interface SessionSandbox {
  run(cmd: string, args: string[], opts?: ProcOptions): Promise<ProcResult>
  copyIn(hostDir: string): Promise<void>
  exportPatch(baseSha: string, hostFile: string): Promise<void>
  close(): Promise<void>
}

export interface SessionDeps {
  open(o: { allowHosts: string[]; allowModels: string[]; lifetimeMs?: number }): Promise<SessionSandbox>
  tmpDir(): string
  log(m: string): void
}

export type Request = { id?: number | string; op: string; [k: string]: unknown }
export type Reply = { id?: number | string; ok: boolean; error?: string; [k: string]: unknown }

const MAX_OUTPUT = 50_000_000
/** The longest a session's worker may live (its PID 1 is a deadline). */
const MAX_LIFETIME_MS = 8 * 3_600_000
/** Never part of a build's patch. */
const ALWAYS_EXCLUDE = ['node_modules']

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const envOf = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) out[k] = x
  return out
}

/** The request handler, separate from stdin/stdout so it can be tested without Docker. */
export function createSession(deps: SessionDeps) {
  let sb: SessionSandbox | null = null
  let baseSha = ''
  const need = () => { if (!sb) throw new Error('no sandbox open: send "open" first'); return sb }

  async function handle(req: Request): Promise<Reply> {
    const { id, op } = req
    try {
      switch (op) {
        case 'open': {
          if (sb) throw new Error('a sandbox is already open in this session')
          const dir = typeof req.dir === 'string' ? req.dir : ''
          if (!path.isAbsolute(dir)) throw new Error('open needs an absolute "dir"')
          const lifetimeMs = typeof req.lifetimeMs === 'number' && req.lifetimeMs > 0 ? Math.min(req.lifetimeMs, MAX_LIFETIME_MS) : undefined
          sb = await deps.open({ allowHosts: strings(req.allowHosts), allowModels: strings(req.allowModels), ...(lifetimeMs ? { lifetimeMs } : {}) })
          await sb.copyIn(dir)
          const head = await sb.run('git', ['rev-parse', 'HEAD'], { timeoutMs: 30_000 })
          if (head.code !== 0) throw new Error(`the copied directory isn't a git clone: ${head.output.trim().slice(-200)}`)
          baseSha = head.output.trim().split('\n').pop()!.trim()
          deps.log(`sandbox open, base ${baseSha.slice(0, 7)}`)
          return { id, ok: true, workdir: WORKDIR, relayUrl: RELAY_URL, modelKey: SANDBOX_MODEL_KEY }
        }
        case 'put': {
          const file = typeof req.path === 'string' ? req.path : ''
          if (!path.posix.isAbsolute(file)) throw new Error('put needs an absolute "path" in the worker')
          const r = await need().run('sh', ['-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', file], { input: String(req.content ?? ''), cwd: '/', timeoutMs: 60_000 })
          if (r.code !== 0) throw new Error(`put failed: ${r.output.trim().slice(-200)}`)
          return { id, ok: true }
        }
        case 'exec': {
          if (typeof req.cmd !== 'string' || !req.cmd) throw new Error('exec needs "cmd"')
          const r = await need().run(req.cmd, strings(req.args), {
            env: envOf(req.env), cwd: typeof req.cwd === 'string' ? req.cwd : WORKDIR,
            timeoutMs: typeof req.timeoutMs === 'number' ? req.timeoutMs : 10 * 60_000, maxOutput: MAX_OUTPUT,
          })
          return { id, ok: true, code: r.code, output: r.output, timedOut: r.timedOut, durationMs: r.durationMs }
        }
        case 'patch': {
          const s = need()
          // Stage everything, then put the excluded paths back to the base commit. Not `:(exclude)`
          // pathspecs: git 2.5x exits 1 when one names a path .gitignore already ignores, and every
          // idea repo ignores node_modules (the tiebreak MVP build lost its patch to it, 2026-10-12).
          const exclude = [...new Set([...ALWAYS_EXCLUDE, ...strings(req.exclude)])]
          const add = await s.run('git', ['add', '-A', '--', '.'], { timeoutMs: 120_000 })
          if (add.code !== 0) throw new Error(`git add failed: ${add.output.trim().slice(-300)}`)
          const unstage = await s.run('git', ['reset', '-q', '--', ...exclude], { timeoutMs: 120_000 })
          if (unstage.code !== 0) throw new Error(`git reset of excluded paths failed: ${unstage.output.trim().slice(-300)}`)
          const commit = await s.run('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'sandbox build'], { timeoutMs: 120_000 })
          if (commit.code !== 0) throw new Error(`git commit failed: ${commit.output.trim().slice(-300)}`)
          const file = path.join(deps.tmpDir(), 'build.patch')
          await s.exportPatch(baseSha, file)
          return { id, ok: true, file }
        }
        case 'close': {
          if (sb) await sb.close()
          sb = null
          return { id, ok: true }
        }
        default:
          throw new Error(`unknown op "${op}"`)
      }
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return { handle, close: async () => { if (sb) await sb.close(); sb = null } }
}

async function main() {
  const cfg = loadConfig()
  const scope = path.join(cfg.home, 'idea-builds')
  const log = (m: string) => process.stderr.write(`[sandbox-session] ${m}\n`)
  const session = createSession({
    log,
    tmpDir: () => mkdtempSync(path.join(tmpdir(), 'idea-build-')),
    open: async ({ allowHosts, allowModels, lifetimeMs }) => {
      if (cfg.sandbox.mode === 'off') throw new Error('the factory sandbox is off (FACTORY_SANDBOX=off)')
      if (!(await dockerAvailable())) throw new Error('Docker is not running')
      await sweepSandboxes(scope)
      const images = await ensureSandboxImages(cfg.sandbox, log)
      const o: SandboxOpenOptions = {
        cfg: { ...cfg.sandbox, allowHosts: [...new Set([...cfg.sandbox.allowHosts, ...allowHosts])], ...(lifetimeMs ? { lifetimeMs: Math.max(lifetimeMs, cfg.sandbox.lifetimeMs) } : {}) },
        litellmUrl: cfg.litellm.url, litellmKey: cfg.litellm.key, allowModels, scope, images,
      }
      return Sandbox.open(o)
    },
  })
  let closing = false
  const shutdown = async (code = 0) => { if (closing) return; closing = true; await session.close(); process.exit(code) }
  process.on('SIGTERM', () => void shutdown(143))
  process.on('SIGINT', () => void shutdown(130))
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  // One request at a time, in order: each reply is written before the next request is read.
  for await (const line of rl) {
    if (!line.trim()) continue
    let req: Request
    try { req = JSON.parse(line) } catch { process.stdout.write(JSON.stringify({ ok: false, error: 'not JSON' }) + '\n'); continue }
    const reply = await session.handle(req)
    process.stdout.write(JSON.stringify(reply) + '\n')
    if (req.op === 'close') return shutdown(0)
  }
  await shutdown(0)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(err => { process.stderr.write(`${err instanceof Error ? err.message : err}\n`); process.exit(1) })
