import { errorExcerpt } from './checks'
import { redCiInvestigated, type LedgerEntry, type ScanEntry, type SignalsEntry } from './ledger'
import { run } from './proc'

/**
 * Sensors (roadmap Phase 78): where the factory's work comes from beyond its own scans. All
 * read-only GitHub API calls on the host (they need the owner's gh login; nothing from the repo
 * runs). The parse/rank functions are pure; the gh wrappers never throw.
 */

// ─── CI on the base branch ───────────────────────────────────────────────────

export interface FailingRun { workflow: string; runId: number; url: string; headSha: string; at: string; conclusion: string }

const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])

/**
 * A failure older than this with no newer run is history, not red CI: a workflow that hasn't run
 * since (disabled, or nothing pushed) can't be fixed by a PR, and kept a repo "red" forever
 * (ai-brand-context's GitHub Pages deploys from June, 2026-10-08).
 */
export const STALE_CI_DAYS = 30

/** Latest completed run per workflow; the ones that failed within the last STALE_CI_DAYS. */
export function failingRuns(runs: { databaseId: number; workflowName: string; conclusion: string | null; status: string; createdAt: string; url: string; headSha: string }[], now = new Date()): FailingRun[] {
  const latest = new Map<string, (typeof runs)[number]>()
  for (const r of runs.filter(x => x.status === 'completed')) {
    const prev = latest.get(r.workflowName)
    if (!prev || r.createdAt > prev.createdAt) latest.set(r.workflowName, r)
  }
  return [...latest.values()]
    .filter(r => FAILED.has(r.conclusion ?? '') && now.getTime() - Date.parse(r.createdAt) <= STALE_CI_DAYS * 86_400_000)
    .map(r => ({ workflow: r.workflowName, runId: r.databaseId, url: r.url, headSha: r.headSha, at: r.createdAt, conclusion: r.conclusion! }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow))
}

export async function ciFailures(repo: string, branch: string, now = new Date()): Promise<FailingRun[] | null> {
  const r = await run('gh', ['run', 'list', '--repo', repo, '--branch', branch, '--limit', '30', '--json', 'databaseId,workflowName,conclusion,status,createdAt,url,headSha'], { timeoutMs: 60_000, maxOutput: 2_000_000 })
  if (r.code !== 0) return null
  try { return failingRuns(JSON.parse(r.output), now) } catch { return null }
}

/** The failing steps' log, trimmed to what a model needs. */
export async function failedLog(repo: string, runId: number): Promise<string> {
  const r = await run('gh', ['run', 'view', String(runId), '--repo', repo, '--log-failed'], { timeoutMs: 120_000, maxOutput: 400_000 })
  // `gh` prefixes each line with "job\tstep\ttimestamp"; keep the message.
  const lines = r.output.split('\n').map(l => l.split('\t').slice(2).join('\t').replace(/^\S+Z\s/, '') || l)
  return errorExcerpt(lines.join('\n'), 80, 8000)
}

// ─── Security alerts ─────────────────────────────────────────────────────────

export interface AlertCounts {
  status: 'ok' | 'disabled' | 'unavailable'
  critical: number
  high: number
  medium: number
  low: number
  /** Open alerts with a patched version in the npm ecosystem (what deps-audit can fix). */
  npmFixable: number
}

const NONE: Omit<AlertCounts, 'status'> = { critical: 0, high: 0, medium: 0, low: 0, npmFixable: 0 }

export function parseDependabotAlerts(code: number | null, output: string): AlertCounts {
  if (code !== 0) return { status: /disabled/i.test(output) ? 'disabled' : 'unavailable', ...NONE }
  try {
    const parsed = JSON.parse(output) as unknown[]
    // `gh api --paginate --slurp` wraps the pages in an outer array; a single page is the alerts array.
    const alerts = (parsed.length > 0 && Array.isArray(parsed[0]) ? parsed.flat() : parsed) as { security_advisory?: { severity?: string }; security_vulnerability?: { severity?: string; first_patched_version?: { identifier?: string } | null; package?: { ecosystem?: string } } }[]
    const c: AlertCounts = { status: 'ok', ...NONE }
    for (const a of alerts) {
      const sev = (a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? 'low').toLowerCase()
      if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') c[sev]++
      if (a.security_vulnerability?.package?.ecosystem === 'npm' && a.security_vulnerability.first_patched_version?.identifier) c.npmFixable++
    }
    return c
  } catch {
    return { status: 'unavailable', ...NONE }
  }
}

export async function dependabotAlerts(repo: string): Promise<AlertCounts> {
  // Every page: one page of 100 undercounted repos with more alerts (family-tree: 59 vs RepoHQ's 77).
  const r = await run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/dependabot/alerts?state=open&per_page=100`], { timeoutMs: 120_000, maxOutput: 20_000_000 })
  return parseDependabotAlerts(r.code, r.output)
}

// ─── Bot PRs ─────────────────────────────────────────────────────────────────

/** Branches autonomous agents use (the release policy's definition). */
export const BOT_BRANCH = /^(feature\/bot\/|nexus\/|factory\/)/
export const STALE_PR_DAYS = 7

export interface BotPrs { open: number; stale: { number: number; url: string; ageDays: number }[] }

/** Stale = an autonomous PR open longer than `days` that nobody has reviewed. */
export function parseBotPrs(prs: { number: number; url: string; headRefName: string; createdAt: string; reviewDecision?: string | null; latestReviews?: unknown[] }[], now: Date, days = STALE_PR_DAYS): BotPrs {
  const bot = prs.filter(p => BOT_BRANCH.test(p.headRefName))
  const stale = bot
    .map(p => ({ number: p.number, url: p.url, ageDays: Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86_400_000), reviewed: !!p.reviewDecision || (p.latestReviews?.length ?? 0) > 0 }))
    .filter(p => p.ageDays >= days && !p.reviewed)
    .map(({ reviewed: _r, ...p }) => p)
  return { open: bot.length, stale }
}

export async function botPrs(repo: string, now: Date, days = STALE_PR_DAYS): Promise<BotPrs | null> {
  const r = await run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', 'number,url,headRefName,createdAt,reviewDecision,latestReviews'], { timeoutMs: 60_000, maxOutput: 2_000_000 })
  if (r.code !== 0) return null
  try { return parseBotPrs(JSON.parse(r.output), now, days) } catch { return null }
}

// ─── Per-repo sensing ────────────────────────────────────────────────────────

export async function baseBranch(repo: string, integrationBranch: string): Promise<string | null> {
  const integ = await run('gh', ['api', `repos/${repo}/branches/${encodeURIComponent(integrationBranch)}`, '--jq', '.name'], { timeoutMs: 30_000 })
  if (integ.code === 0 && integ.output.trim() === integrationBranch) return integrationBranch
  const def = await run('gh', ['api', `repos/${repo}`, '--jq', '.default_branch'], { timeoutMs: 30_000 })
  return def.code === 0 ? def.output.trim() || null : null
}

export async function senseRepo(repo: string, integrationBranch: string, runId: string, now: Date): Promise<SignalsEntry> {
  const base = await baseBranch(repo, integrationBranch)
  const [ci, alerts, prs] = await Promise.all([base ? ciFailures(repo, base, now) : Promise.resolve(null), dependabotAlerts(repo), botPrs(repo, now)])
  return {
    type: 'signals', runId, at: now.toISOString(), repo, base,
    redCi: ci, alerts, botPrs: prs,
  }
}

// ─── Opportunity queue ───────────────────────────────────────────────────────

/** Category weights: red CI > security > failing checks > docs (roadmap Phase 78). */
export const WEIGHTS = { redCi: 100, security: 80, deps: 70, checks: 60, neverScanned: 50, docs: 20 } as const
/** Max age bonus = 7 × 1.25 = 8.75 < the smallest gap between category weights (10). */
export const AGE_POINTS_PER_DAY = 1.25
const CHECK_KINDS = new Set(['fix-types', 'fix-lint', 'fix-tests', 'lint-autofix'])

export interface Opportunity { repo: string; score: number; reasons: string[]; blocked: string | null }

/**
 * Rank allowlisted repos by the value of their best known work. A repo's last scan tells
 * what's failing; signals add red CI, alerts and stale bot PRs; a low RepoHQ health score
 * raises priority; clean repos still come round again as their last scan ages.
 */
export function rankOpportunities(
  repos: string[], entries: LedgerEntry[], signals: SignalsEntry[], now: Date,
  opts: {
    health?: Map<string, number>; blockOnStalePrs?: boolean; redCiReportOnly?: boolean
    /** Why red CI can't be worked on this cycle (at stage report it needs the free pool); null/absent = it can. */
    redCiParked?: string | null
  } = {},
): Opportunity[] {
  const lastScan = new Map<string, ScanEntry>()
  for (const e of entries) if (e.type === 'scan' && (!lastScan.get(e.repo) || e.at > lastScan.get(e.repo)!.at)) lastScan.set(e.repo, e)
  return repos.map(repo => {
    const s = signals.find(x => x.repo === repo)
    const scan = lastScan.get(repo)
    const reasons: string[] = []
    let score = 0
    const bump = (w: number, why: string) => { reasons.push(why); score = Math.max(score, w) }
    // At stage `report` a red CI that's already been investigated has nothing left for the factory
    // to do until it changes, so it no longer outranks work that can still produce a PR.
    // Likewise while it can't be investigated at all (free pool exhausted): it would only be deferred.
    const redCi = opts.redCiParked ? [] : (s?.redCi ?? []).filter(r => !(opts.redCiReportOnly && redCiInvestigated(entries, repo, r)))
    if (redCi.length) bump(WEIGHTS.redCi, `red CI: ${redCi.map(r => r.workflow).join(', ')}`)
    if (s?.alerts && s.alerts.critical + s.alerts.high > 0) bump(WEIGHTS.security, `${s.alerts.critical + s.alerts.high} high/critical alerts`)
    if (scan?.tasks.includes('deps-audit')) bump(WEIGHTS.deps, 'npm audit high/critical')
    const failing = scan?.tasks.filter(t => CHECK_KINDS.has(t)) ?? []
    if (failing.length) bump(WEIGHTS.checks, failing.join(', '))
    if (!scan) bump(WEIGHTS.neverScanned, 'never scanned')
    if (scan?.tasks.includes('docs-readme')) bump(WEIGHTS.docs, 'README gaps')
    // Age orders repos within a category and brings clean repos round again; it stays below
    // the 10-point gap between categories so it never outranks more valuable work.
    if (scan) score += Math.min((now.getTime() - new Date(scan.at).getTime()) / 86_400_000, 7) * AGE_POINTS_PER_DAY
    const h = opts.health?.get(repo.toLowerCase())
    if (h !== undefined) score *= 1 + (100 - Math.max(0, Math.min(100, h))) / 200
    const stale = s?.botPrs?.stale.length ?? 0
    const blocked = opts.blockOnStalePrs && stale > 0 ? `${stale} stale bot PR(s) unreviewed for ${STALE_PR_DAYS}+ days` : null
    return { repo, score: Math.round(score * 10) / 10, reasons, blocked }
  }).sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || b.score - a.score || a.repo.localeCompare(b.repo))
}
