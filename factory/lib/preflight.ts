import { readdirSync, rmSync, statSync, statfsSync } from 'node:fs'
import path from 'node:path'
import type { FactoryConfig } from './config'
import { githubApp } from './github-app'
import { run } from './proc'
import { sandboxImages } from './sandbox'

/**
 * Morning-report preflight (2026-10-09 hardening): each thing a night shift silently depends on,
 * checked when the report runs so a broken one shows up that morning instead of as "factory idle"
 * 36 hours later. Every probe degrades to a failed check, never throws.
 */

export interface PreflightCheck {
  name: string
  ok: boolean
  /** Short status for the summary line ("10/10 repos", "162 GB free"). */
  detail: string
  /** What to do when it fails. */
  fix?: string
  /** A warning, not an outage: shown with ⚠ but doesn't raise the report's alarm. */
  soft?: boolean
}

export function preflightLines(checks: PreflightCheck[]): { lines: string[]; alarm: boolean } {
  if (checks.length === 0) return { lines: [], alarm: false }
  const failed = checks.filter(c => !c.ok)
  return {
    lines: [
      `Preflight: ${checks.map(c => `${c.name} ${c.ok ? '✓' : '✗'}${c.detail ? ` (${c.detail})` : ''}`).join(' · ')}.`,
      ...failed.map(c => `⚠ ${c.name}: ${c.detail}${c.fix ? ` — ${c.fix}` : ''}.`),
    ],
    alarm: failed.some(c => !c.soft),
  }
}

/** Allowlisted repos the GitHub App can't reach (pushes to them would fail). */
export function missingFromApp(allowlist: string[], installed: string[]): string[] {
  const have = new Set(installed.map(r => r.toLowerCase()))
  return allowlist.filter(r => !have.has(r.toLowerCase()))
}

/** Parse `sysctl vm.swapusage`: "total = 9216.00M  used = 8052.12M ...". */
export function swapUsage(out: string): { usedMb: number; totalMb: number } | null {
  const total = /total = ([\d.]+)M/.exec(out)?.[1]
  const used = /used = ([\d.]+)M/.exec(out)?.[1]
  return total && used ? { usedMb: Number(used), totalMb: Number(total) } : null
}

/**
 * Parse `sysctl -n kern.memorystatus_vm_pressure_level`, macOS's own memory pressure signal
 * (1 normal, 2 warning, 4 critical). Swap used is no alarm on its own: macOS keeps cold pages
 * swapped out and grows the swap file with uptime, so "9 of 10 GB" can be a healthy machine.
 */
export function memoryPressure(out: string): 'normal' | 'warning' | 'critical' | null {
  const level = Number(out.trim().split(/\s+/).pop())
  return level === 1 ? 'normal' : level === 2 ? 'warning' : level === 4 ? 'critical' : null
}

export const MIN_FREE_DISK_GB = 15

export async function runPreflight(cfg: FactoryConfig): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = []

  if (cfg.sandbox.mode === 'docker') {
    const docker = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20_000 })
    if (docker.code !== 0) {
      checks.push({ name: 'Docker', ok: false, detail: 'not running', fix: 'start Docker Desktop; scheduled cycles refuse to run without the sandbox' })
    } else {
      checks.push({ name: 'Docker', ok: true, detail: '' })
      const tag = sandboxImages(cfg.sandbox).worker.tag
      const img = await run('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { timeoutMs: 20_000 })
      checks.push(img.code === 0
        ? { name: 'sandbox image', ok: true, detail: '' }
        : { name: 'sandbox image', ok: false, detail: `${tag} missing`, fix: 'run npm run factory:sandbox:build (or factory/bin/install-launchd.sh)' })
    }
  }

  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5_000) })
    checks.push({ name: 'Ollama', ok: r.ok, detail: r.ok ? '' : `HTTP ${r.status}`, fix: 'start Ollama (local M0 tier and the local reviewer use it)', soft: true })
  } catch {
    checks.push({ name: 'Ollama', ok: false, detail: 'not reachable', fix: 'start Ollama (local M0 tier and the local reviewer use it)', soft: true })
  }

  const app = githubApp()
  if (app) {
    try {
      const token = await app.installationToken()
      const res = await fetch('https://api.github.com/installation/repositories?per_page=100', {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000),
      })
      const body = (await res.json()) as { repositories?: { full_name: string }[] }
      const missing = missingFromApp(cfg.repos, (body.repositories ?? []).map(r => r.full_name))
      checks.push(missing.length === 0
        ? { name: 'GitHub App', ok: true, detail: `${cfg.repos.length}/${cfg.repos.length} repos` }
        : { name: 'GitHub App', ok: false, detail: `can't reach ${missing.map(r => r.split('/')[1]).join(', ')}`, fix: 'add them to the repohq-factory installation (GitHub → Settings → Applications → Configure), or drop them from the allowlist' })
    } catch (err) {
      checks.push({ name: 'GitHub App', ok: false, detail: `no token (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`, fix: 'check ~/.repohq-factory/github-app.pem and FACTORY_GH_APP_CLIENT_ID; the factory falls back to your gh login' })
    }
  }

  // Your own gh login (Copilot, the review-queue search) — GH_TOKEN '' so it isn't the app's token.
  const gh = await run('gh', ['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 20_000, env: { GH_TOKEN: '' } })
  checks.push({ name: 'gh login', ok: gh.code === 0, detail: gh.code === 0 ? '' : 'not logged in or token rejected', fix: 'run gh auth login' })

  try {
    const fs = statfsSync(cfg.home)
    const freeGb = Math.round((fs.bavail * fs.bsize) / 1e9)
    checks.push({ name: 'disk', ok: freeGb >= MIN_FREE_DISK_GB, detail: `${freeGb} GB free`, fix: 'free space; docker system prune reclaims old sandbox images and build cache' })
  } catch { /* not fatal */ }

  const [pressureOut, swapOut] = await Promise.all([
    run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeoutMs: 5_000 }),
    run('sysctl', ['vm.swapusage'], { timeoutMs: 5_000 }),
  ])
  const pressure = memoryPressure(pressureOut.output)
  const s = swapUsage(swapOut.output)
  if (pressure) {
    const swapNote = s && s.totalMb > 0 ? ` · swap ${(s.usedMb / 1024).toFixed(1)} of ${(s.totalMb / 1024).toFixed(1)} GB` : ''
    checks.push({
      name: 'memory', ok: pressure === 'normal', detail: `pressure ${pressure}${swapNote}`,
      fix: 'memory is tight right now: quit apps you are not using or restart the Mac', soft: true,
    })
  }
  return checks
}

/**
 * Remove run work folders older than `maxAgeDays` (each holds a run's clones; a crash or a
 * pre-sandbox run could leave hundreds of MB behind — 77 folders, 800 MB by 2026-10-09).
 */
export function sweepWorkDirs(home: string, now: Date, maxAgeDays = 2): number {
  const dir = path.join(home, 'work')
  let removed = 0
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return 0 }
  for (const name of names) {
    const p = path.join(dir, name)
    try {
      if (now.getTime() - statSync(p).mtimeMs > maxAgeDays * 86_400_000) { rmSync(p, { recursive: true, force: true }); removed++ }
    } catch { /* in use or gone */ }
  }
  return removed
}
