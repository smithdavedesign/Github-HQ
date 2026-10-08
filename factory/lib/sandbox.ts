/**
 * Docker sandbox for target-repo code (docs/autonomous-factory.md §14, roadmap Phase 76).
 *
 * `npm ci`, the repo's checks and the model harness run its code, so they run here instead of
 * on the owner's Mac:
 *
 *   host (factory) ──docker exec──▶ worker ──(internal network)──▶ egress ──▶ registries / LiteLLM
 *
 * - worker: no mounts, no Docker socket, no GitHub credential, no host environment (only the
 *   per-command overrides a Runner is given), non-root, all capabilities dropped,
 *   no-new-privileges, CPU / memory / pid limits, and a PID 1 that exits after `lifetimeMs`.
 * - network: the worker is on an `--internal` network with no route out. Its only peer is the
 *   egress container, which allows package registries (`allowHosts`) through a proxy and
 *   relays model calls to LiteLLM for an allowlist of model aliases (free tiers by default).
 * - The repo goes in as a tar stream; what comes back is a patch, which the host applies to
 *   its own clone, judges, commits and pushes. Repo code never runs on the host.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SandboxConfig } from './config'
import { run, type ProcOptions, type Runner } from './proc'

export const WORKDIR = '/workspace'
/** Worker-side LiteLLM URL: the egress relay (it forwards only allowed models). */
export const RELAY_URL = 'http://egress:4000'
const PROXY_URL = 'http://egress:8888'
const LABEL = 'repohq.factory.sandbox'
const DOCKER_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docker')

/** Exit codes from `timeout` (GNU coreutils) when the command overran: TERM then KILL. */
const TIMEOUT_CODES = new Set([124, 137])

export async function dockerAvailable(): Promise<boolean> {
  const r = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20_000 })
  return r.code === 0 && r.output.trim().length > 0
}

/** `name:<12-hex>` — a hash of the image's build inputs, so any edit produces a new tag. */
export function imageTag(name: string, inputs: string[]): string {
  const h = createHash('sha256')
  for (const i of inputs) h.update(i).update('\0')
  return `${name}:${h.digest('hex').slice(0, 12)}`
}

interface ImageSpec { tag: string; dockerfile: string }

export function sandboxImages(cfg: SandboxConfig, dir = DOCKER_DIR): { worker: ImageSpec; egress: ImageSpec } {
  const read = (f: string) => readFileSync(path.join(dir, f), 'utf8')
  return {
    worker: { tag: imageTag(cfg.workerImage, [read('worker.Dockerfile')]), dockerfile: 'worker.Dockerfile' },
    egress: {
      tag: imageTag(cfg.egressImage, [read('egress.Dockerfile'), read('egress-entrypoint.sh'), read('egress-relay.mjs')]),
      dockerfile: 'egress.Dockerfile',
    },
  }
}

/** Build any missing image (first run, or after a Dockerfile change). The worker build takes a few minutes. */
export async function ensureSandboxImages(cfg: SandboxConfig, log: (m: string) => void = () => {}): Promise<{ worker: string; egress: string }> {
  const images = sandboxImages(cfg)
  for (const img of [images.egress, images.worker]) {
    if ((await run('docker', ['image', 'inspect', img.tag], { timeoutMs: 30_000 })).code === 0) continue
    log(`building sandbox image ${img.tag}`)
    const r = await run('docker', ['build', '-q', '-t', img.tag, '-f', path.join(DOCKER_DIR, img.dockerfile), DOCKER_DIR], { timeoutMs: 30 * 60_000 })
    if (r.code !== 0) throw new Error(`sandbox image build failed (${img.tag}): ${r.output.trim().split('\n').slice(-5).join(' | ')}`)
  }
  // Superseded tags (older Dockerfiles) are ~2 GB each on a small Docker VM disk: drop them.
  for (const img of [images.egress, images.worker]) {
    const [repo, current] = img.tag.split(':')
    const tags = (await run('docker', ['image', 'ls', repo, '--format', '{{.Tag}}'], { timeoutMs: 30_000 })).output.split('\n').map(t => t.trim()).filter(t => t && t !== current && t !== '<none>')
    if (tags.length > 0) await run('docker', ['image', 'rm', ...tags.map(t => `${repo}:${t}`)], { timeoutMs: 120_000 })
  }
  return { worker: images.worker.tag, egress: images.egress.tag }
}

/** LiteLLM as the egress container sees it: the host's gateway via host.docker.internal. */
export function upstreamUrl(hostLitellmUrl: string): string {
  const u = new URL(hostLitellmUrl)
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') u.hostname = 'host.docker.internal'
  return u.origin
}

/** Proxy settings for every tool the worker runs (npm, pnpm, yarn, pip, Node, curl). Model calls go direct to the relay. */
export function proxyEnv(): Record<string, string> {
  const noProxy = 'egress,localhost,127.0.0.1'
  return {
    HTTP_PROXY: PROXY_URL, HTTPS_PROXY: PROXY_URL, http_proxy: PROXY_URL, https_proxy: PROXY_URL,
    NO_PROXY: noProxy, no_proxy: noProxy,
    npm_config_proxy: PROXY_URL, npm_config_https_proxy: PROXY_URL,
    YARN_HTTP_PROXY: PROXY_URL, YARN_HTTPS_PROXY: PROXY_URL,
  }
}

export interface SandboxNames { network: string; egress: string; worker: string; label: string }

export function sandboxNames(scope: string, id = randomUUID().slice(0, 8)): SandboxNames {
  return {
    network: `repohq-sbx-${id}`,
    egress: `repohq-sbx-${id}-egress`,
    worker: `repohq-sbx-${id}-worker`,
    label: `${LABEL}=${createHash('sha256').update(scope).digest('hex').slice(0, 12)}`,
  }
}

export function egressRunArgs(n: SandboxNames, image: string, opts: { allowHosts: string[]; allowModels: string[]; upstream: string }): string[] {
  return [
    'run', '-d', '--name', n.egress, '--label', n.label,
    // Default bridge for the way out; the internal network is attached afterwards with alias "egress".
    '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
    '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--pids-limit', '256',
    '-e', `EGRESS_ALLOW_HOSTS=${opts.allowHosts.join(' ')}`,
    '-e', `EGRESS_ALLOW_MODELS=${opts.allowModels.join(' ')}`,
    '-e', `LITELLM_UPSTREAM=${opts.upstream}`,
    image,
  ]
}

export function workerRunArgs(n: SandboxNames, image: string, cfg: SandboxConfig): string[] {
  return [
    'run', '-d', '--name', n.worker, '--label', n.label,
    '--network', n.network,
    '--init', '--user', 'worker', '-w', WORKDIR,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--cpus', String(cfg.cpus), '--memory', cfg.memory, '--memory-swap', cfg.memory, '--pids-limit', String(cfg.pidsLimit),
    ...Object.entries(proxyEnv()).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    image,
    // PID 1 is a deadline: the container stops itself even if the factory dies mid-job.
    'sleep', String(Math.ceil(cfg.lifetimeMs / 1000)),
  ]
}

/**
 * `docker exec` arguments for one command. Only `opts.env` is forwarded (never the host's
 * environment), and the command runs under `timeout` inside the container so an overrun
 * is killed there, not just the local docker client.
 */
export function execArgs(container: string, cmd: string, args: string[], opts: Pick<ProcOptions, 'cwd' | 'env' | 'input' | 'timeoutMs'> = {}): string[] {
  const out = ['exec']
  if (opts.input !== undefined) out.push('-i')
  out.push('-w', opts.cwd ?? WORKDIR)
  for (const [k, v] of Object.entries(opts.env ?? {})) if (v !== undefined) out.push('-e', `${k}=${v}`)
  const secs = Math.max(1, Math.ceil((opts.timeoutMs ?? 10 * 60_000) / 1000))
  out.push(container, 'timeout', '-k', '10', String(secs), cmd, ...args)
  return out
}

/** Remove every container and network a previous (crashed) cycle left behind for this scope. */
export async function sweepSandboxes(scope: string): Promise<number> {
  const label = sandboxNames(scope).label
  const ids = (await run('docker', ['ps', '-aq', '--filter', `label=${label}`], { timeoutMs: 30_000 })).output.split('\n').map(s => s.trim()).filter(Boolean)
  if (ids.length > 0) await run('docker', ['rm', '-f', ...ids], { timeoutMs: 60_000 })
  const nets = (await run('docker', ['network', 'ls', '-q', '--filter', `label=${label}`], { timeoutMs: 30_000 })).output.split('\n').map(s => s.trim()).filter(Boolean)
  if (nets.length > 0) await run('docker', ['network', 'rm', ...nets], { timeoutMs: 60_000 })
  return ids.length
}

export interface SandboxOpenOptions {
  cfg: SandboxConfig
  /** The host's LiteLLM URL (factory config). */
  litellmUrl: string
  /** LiteLLM aliases the worker may call through the relay. */
  allowModels: string[]
  /** Groups this factory's sandboxes for sweeping (the factory home dir). */
  scope: string
  images: { worker: string; egress: string }
}

export class Sandbox {
  readonly dir = WORKDIR
  readonly litellmUrl = RELAY_URL
  private closed = false

  private constructor(readonly names: SandboxNames) {}

  static async open(o: SandboxOpenOptions): Promise<Sandbox> {
    const n = sandboxNames(o.scope)
    const sb = new Sandbox(n)
    const must = async (label: string, args: string[], timeoutMs = 120_000) => {
      const r = await run('docker', args, { timeoutMs })
      if (r.code !== 0) throw new Error(`sandbox ${label} failed: ${r.output.trim().split('\n').slice(-3).join(' | ')}`)
      return r
    }
    try {
      await must('network', ['network', 'create', '--internal', '--label', n.label, n.network])
      await must('egress', egressRunArgs(n, o.images.egress, { allowHosts: o.cfg.allowHosts, allowModels: o.allowModels, upstream: upstreamUrl(o.litellmUrl) }))
      await must('egress attach', ['network', 'connect', '--alias', 'egress', n.network, n.egress])
      await must('worker', workerRunArgs(n, o.images.worker, o.cfg))
      await sb.waitForEgress()
      return sb
    } catch (err) {
      await sb.close()
      throw err
    }
  }

  /** Run a command in the worker. Same contract as `run`, so checks/harness/git take it as a Runner. */
  readonly run: Runner = async (cmd, args, opts = {}) => {
    const r = await run('docker', execArgs(this.names.worker, cmd, args, opts), {
      // The in-container `timeout` fires first; this outer one only catches a wedged docker client.
      timeoutMs: (opts.timeoutMs ?? 10 * 60_000) + 30_000,
      maxOutput: opts.maxOutput,
      input: opts.input,
    })
    return { ...r, timedOut: r.timedOut || (r.code !== null && TIMEOUT_CODES.has(r.code) && r.durationMs >= (opts.timeoutMs ?? 10 * 60_000)) }
  }

  /** Copy a host directory (the clone, including .git) into the workspace as a tar stream, owned by the worker user. */
  async copyIn(hostDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tar = spawn('tar', ['--no-xattrs', '--no-mac-metadata', '-C', hostDir, '-cf', '-', '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      const dock = spawn('docker', ['exec', '-i', this.names.worker, 'tar', '-C', WORKDIR, '-xf', '-'], { stdio: ['pipe', 'ignore', 'pipe'] })
      let err = ''
      tar.stderr.on('data', b => { err += b })
      dock.stderr.on('data', b => { err += b })
      tar.stdout.pipe(dock.stdin)
      let tarCode: number | null = null
      tar.on('close', c => { tarCode = c })
      dock.on('close', c => (c === 0 && tarCode === 0 ? resolve() : reject(new Error(`sandbox copy-in failed (tar ${tarCode}, docker ${c}): ${err.trim().slice(-500)}`))))
      tar.on('error', reject)
      dock.on('error', reject)
    })
  }

  /** A workspace file's contents, or null if it doesn't exist. */
  async readFile(rel: string): Promise<string | null> {
    const r = await this.run('cat', ['--', rel], { timeoutMs: 30_000, maxOutput: 5_000_000 })
    return r.code === 0 ? r.output : null
  }

  /** Write `git diff <baseSha> HEAD` (binary-safe) to a host file. */
  async exportPatch(baseSha: string, hostFile: string): Promise<void> {
    const inside = `/tmp/factory-${randomUUID().slice(0, 8)}.patch`
    const d = await this.run('git', ['diff', '--binary', `--output=${inside}`, baseSha, 'HEAD'], { timeoutMs: 120_000 })
    if (d.code !== 0) throw new Error(`sandbox diff failed: ${d.output.trim().slice(-300)}`)
    const cp = await run('docker', ['cp', `${this.names.worker}:${inside}`, hostFile], { timeoutMs: 120_000 })
    if (cp.code !== 0) throw new Error(`sandbox patch copy-out failed: ${cp.output.trim().slice(-300)}`)
  }

  /** Remove the worker, egress and network. Safe to call more than once. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await run('docker', ['rm', '-f', this.names.worker, this.names.egress], { timeoutMs: 60_000 })
    await run('docker', ['network', 'rm', this.names.network], { timeoutMs: 60_000 })
  }

  private async waitForEgress(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const r = await run('docker', ['exec', this.names.egress, 'sh', '-c', 'nc -z 127.0.0.1 8888 && nc -z 127.0.0.1 4000'], { timeoutMs: 10_000 })
      if (r.code === 0) return
      await new Promise(res => setTimeout(res, 500))
    }
    throw new Error('sandbox egress did not become ready')
  }
}

/** Models the sandbox may call: the free tiers always, the paid alias only when a paid budget exists. */
export function sandboxModels(models: { M0: string; M1: string; M2: string }, opts: { paidBudgetUsd: number; extra?: string[] }): string[] {
  const list = [models.M0, models.M1, ...(opts.extra ?? [])]
  if (opts.paidBudgetUsd > 0) list.push(models.M2)
  return [...new Set(list)]
}

