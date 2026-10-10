/**
 * Preview smoke test: load a factory PR's Vercel preview in a real browser and compare it with
 * production. The factory's checks (typecheck, lint, tests, build) don't run the app; on 2026-10-10
 * two merged factory PRs broke things only a running app shows (a server-rendered "You're offline"
 * banner with a hydration error, and a site that no longer built).
 *
 * Verdict per PR: `fail` when a page that works on production doesn't on the preview (HTTP status,
 * a page crash, or a console error production doesn't have); `pass`; or `skipped` with the reason
 * (no Vercel preview, not ready yet). Runs in the reconcile step of a later cycle, so no cycle waits
 * on a preview build. Also run by hand: `npm run factory:smoke -- <pr-url>` (skill: preview-smoke).
 *
 * Pages behind a login are out of reach (no credentials are used); only public paths are compared.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run } from './proc'
import type { AttemptEntry, LedgerEntry } from './ledger'

export const SMOKE_FAIL_LABEL = 'smoke:fail'

export interface PageResult {
  url: string
  path: string
  status: number | null
  consoleErrors: string[]
  pageErrors: string[]
  error?: string
}

export interface SmokeEntry {
  type: 'smoke'
  attemptId: string
  at: string
  repo: string
  prUrl: string
  verdict: 'pass' | 'fail' | 'skipped'
  previewUrl?: string
  productionUrl?: string
  reasons: string[]
}

/** Same error modulo URLs, hashes, numbers and whitespace: production noise mustn't fail a preview. */
export function normalizeError(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

const ok = (p: PageResult) => p.status !== null && p.status < 400 && !p.error

/**
 * Third-party chatter that comes and goes between loads (seen 2026-10-10: Google sign-in's FedCM
 * prompt logged an error on one load and not the next). Never the app's own problem.
 */
export const NOISE = /GSI_LOGGER|FedCM|Provider's accounts list is empty|chrome-extension:\/\/|Download the React DevTools/i

/**
 * Pure comparison of the same paths on production and on the preview. Each side is loaded more than
 * once: an error counts only if it shows on every preview load and on no production load, so flaky
 * third-party noise doesn't fail a PR. A status or crash regression counts on any preview load.
 */
export function compareSmoke(productionRuns: PageResult[][], previewRuns: PageResult[][]): { verdict: 'pass' | 'fail'; reasons: string[] } {
  const reasons: string[] = []
  const errorsOf = (p?: PageResult) => [...(p?.consoleErrors ?? []), ...(p?.pageErrors ?? [])].filter(e => !NOISE.test(e))
  const paths = [...new Set(previewRuns.flat().map(p => p.path))]
  for (const path of paths) {
    const prods = productionRuns.map(r => r.find(p => p.path === path)).filter((p): p is PageResult => !!p)
    const previews = previewRuns.map(r => r.find(p => p.path === path)).filter((p): p is PageResult => !!p)
    const prodOk = prods.length === 0 || prods.some(ok)
    const broken = previews.find(p => !ok(p))
    if (prodOk && broken) {
      reasons.push(`${path}: ${broken.error ?? `HTTP ${broken.status}`} on the preview${prods[0] ? ` (production: HTTP ${prods[0].status})` : ''}`)
      continue
    }
    const known = new Set(prods.flatMap(errorsOf).map(normalizeError))
    const counts = new Map<string, { n: number; sample: string; page: boolean }>()
    for (const pv of previews) {
      for (const e of new Set(errorsOf(pv))) {
        const k = normalizeError(e)
        const c = counts.get(k) ?? { n: 0, sample: e, page: pv.pageErrors.includes(e) }
        c.n++
        counts.set(k, c)
      }
    }
    for (const [k, c] of counts) {
      if (known.has(k) || c.n < previews.length) continue
      reasons.push(`${path}: ${c.page ? 'page' : 'console'} error on the preview only — ${c.sample.slice(0, 200)}`)
    }
  }
  return { verdict: reasons.length ? 'fail' : 'pass', reasons }
}

/** Attempts with an open PR that haven't been smoke-tested, at least `minAgeMs` after the PR (preview build time). */
export function pendingSmokes(entries: LedgerEntry[], now: Date, minAgeMs = 5 * 60_000): AttemptEntry[] {
  const done = new Set(entries.filter((e): e is SmokeEntry => e.type === 'smoke').map(e => e.attemptId))
  const resolved = new Set(entries.filter(e => e.type === 'resolution').map(e => (e as { attemptId: string }).attemptId))
  return entries.filter((e): e is AttemptEntry => e.type === 'attempt')
    .filter(a => !!a.prUrl && !done.has(a.id) && !resolved.has(a.id) && now.getTime() - new Date(a.at).getTime() >= minAgeMs)
}

export function smokeComment(entry: SmokeEntry): string {
  const head = entry.verdict === 'pass' ? '✅ **Preview smoke: pass**' : entry.verdict === 'fail' ? '❌ **Preview smoke: fail**' : '⏭️ **Preview smoke: skipped**'
  return [
    `## Preview smoke (RepoHQ factory)`, '', head, '',
    ...(entry.previewUrl ? [`Preview: ${entry.previewUrl}${entry.productionUrl ? ` · compared with production: ${entry.productionUrl}` : ''}`, ''] : []),
    ...entry.reasons.map(r => `- ${r}`),
    '', '<sub>Loads public pages in a headless browser and compares HTTP status, page crashes and console errors with production. Pages behind a login are not checked.</sub>',
  ].join('\n')
}

// ─── GitHub / Vercel lookups ───────────────────────────────────────────────

interface DeploymentStatus { state: string; environment_url?: string }

async function ghJson<T>(endpoint: string, jq?: string): Promise<T | null> {
  // --jq keeps the output small: the process runner caps captured output.
  const r = await run('gh', ['api', endpoint, ...(jq ? ['--jq', jq] : [])], { timeoutMs: 60_000 })
  if (r.code !== 0) return null
  try { return JSON.parse(r.output) as T } catch { return null }
}

/** The latest successful deployment URL for a commit in an environment matching `env`. */
export async function deploymentUrl(repo: string, sha: string | null, env: RegExp): Promise<{ url: string | null; state: string }> {
  // The deployments API matches full commit hashes only.
  const full = sha && sha.length < 40 ? (await ghJson<string>(`repos/${repo}/commits/${sha}`, '.sha|tojson')) : sha
  const deps = await ghJson<Array<{ environment: string; statuses_url: string; sha: string }>>(
    `repos/${repo}/deployments?per_page=30${full ? `&sha=${full}` : ''}`, '[.[]|{environment, statuses_url, sha}]')
  const match = (deps ?? []).filter(d => env.test(d.environment))
  if (!match.length) return { url: null, state: 'none' }
  for (const d of match) {
    const statuses = await ghJson<DeploymentStatus[]>(d.statuses_url.replace('https://api.github.com/', ''), '[.[]|{state, environment_url}]')
    const latest = statuses?.[0]
    if (latest?.state === 'success' && latest.environment_url) return { url: latest.environment_url, state: 'success' }
    if (latest && ['pending', 'in_progress', 'queued'].includes(latest.state)) return { url: null, state: 'pending' }
  }
  return { url: null, state: 'failure' }
}

/** `vercel api` prints a banner line ("api is in beta") before the JSON. */
const cliJson = (out: string) => JSON.parse(out.slice(out.indexOf('{')))

/**
 * Vercel's "Protection Bypass for Automation" secret for the repo's project, created once and cached
 * (the owner's projects protect every deployment but custom domains). Null when the repo has no
 * Vercel project or the Vercel CLI isn't logged in.
 */
export async function bypassSecret(repo: string, home: string, scope?: string): Promise<string | null> {
  const cacheFile = path.join(home, 'vercel-bypass.json')
  const cache: Record<string, string> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
  if (cache[repo]) return cache[repo]
  const scopeArgs = scope ? ['--scope', scope] : []
  // Project JSON is large (build settings, env metadata): lift the runner's output cap.
  const list = await run('vercel', ['api', `/v9/projects?repoUrl=https://github.com/${repo}`, ...scopeArgs], { timeoutMs: 60_000, maxOutput: 5_000_000 })
  let project: { id: string; protectionBypass?: Record<string, { scope: string }> } | undefined
  try { project = cliJson(list.output).projects?.[0] } catch { return null }
  if (!project) return null
  const existing = Object.entries(project.protectionBypass ?? {}).find(([, v]) => v.scope === 'automation-bypass')?.[0]
  let secret = existing ?? null
  if (!secret) {
    const tmp = path.join(home, '.bypass-body.json')
    writeFileSync(tmp, JSON.stringify({ generate: {} }))
    const created = await run('vercel', ['api', `/v1/projects/${project.id}/protection-bypass`, '-X', 'PATCH', '--input', tmp, ...scopeArgs], { timeoutMs: 60_000, maxOutput: 5_000_000 })
    try {
      const pb = cliJson(created.output).protectionBypass as Record<string, { scope: string }>
      secret = Object.entries(pb ?? {}).find(([, v]) => v.scope === 'automation-bypass')?.[0] ?? null
    } catch { secret = null }
  }
  if (secret) {
    mkdirSync(home, { recursive: true })
    writeFileSync(cacheFile, JSON.stringify({ ...cache, [repo]: secret }, null, 2), { mode: 0o600 })
  }
  return secret
}

/** Visit each path in a headless browser; bypass header only for *.vercel.app hosts. */
export async function visit(base: string, paths: string[], bypass: string | null): Promise<PageResult[]> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const results: PageResult[] = []
  try {
    for (const p of paths) {
      const url = new URL(p, base).toString()
      const context = await browser.newContext({
        extraHTTPHeaders: bypass && /\.vercel\.app$/.test(new URL(url).hostname)
          ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {},
      })
      const page = await context.newPage()
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
      page.on('pageerror', e => pageErrors.push(e.message))
      try {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
        await page.waitForTimeout(3_000) // hydration errors surface after load
        results.push({ url, path: p, status: res?.status() ?? null, consoleErrors, pageErrors })
      } catch (e) {
        results.push({ url, path: p, status: null, consoleErrors, pageErrors, error: String((e as Error).message).split('\n')[0]!.slice(0, 200) })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
  return results
}

/** Smoke-test one PR. Never throws: problems become a `skipped` verdict with the reason. */
export async function smokePr(opts: {
  repo: string; prUrl: string; attemptId: string; home: string; paths?: string[]; vercelScope?: string
}): Promise<SmokeEntry> {
  const base: Omit<SmokeEntry, 'verdict' | 'reasons'> = { type: 'smoke', attemptId: opts.attemptId, at: new Date().toISOString(), repo: opts.repo, prUrl: opts.prUrl }
  const skip = (reason: string): SmokeEntry => ({ ...base, verdict: 'skipped', reasons: [reason] })
  try {
    const pr = await run('gh', ['pr', 'view', opts.prUrl, '--json', 'headRefOid,state'], { timeoutMs: 60_000 })
    const { headRefOid, state } = JSON.parse(pr.output) as { headRefOid: string; state: string }
    if (state !== 'OPEN') return skip(`PR is ${state.toLowerCase()}`)
    const preview = await deploymentUrl(opts.repo, headRefOid, /preview/i)
    if (!preview.url) return skip(preview.state === 'none' ? 'no Vercel preview for this commit' : `preview ${preview.state}`)
    const production = await deploymentUrl(opts.repo, null, /^production$/i)
    if (!production.url) return { ...skip('no production deployment to compare with'), previewUrl: preview.url }
    const bypass = await bypassSecret(opts.repo, opts.home, opts.vercelScope)
    const paths = opts.paths?.length ? opts.paths : ['/']
    const prodRuns = [await visit(production.url, paths, bypass), await visit(production.url, paths, bypass)]
    const previewRuns = [await visit(preview.url, paths, bypass), await visit(preview.url, paths, bypass)]
    if (prodRuns[0]!.every(p => p.status === 401 || p.status === 403)) return { ...skip('pages are protected and no bypass secret was available'), previewUrl: preview.url }
    const { verdict, reasons } = compareSmoke(prodRuns, previewRuns)
    return { ...base, verdict, reasons: reasons.length ? reasons : [`${paths.length} page(s) load like production`], previewUrl: preview.url, productionUrl: production.url }
  } catch (e) {
    return skip(`smoke test error: ${String((e as Error).message).slice(0, 200)}`)
  }
}
