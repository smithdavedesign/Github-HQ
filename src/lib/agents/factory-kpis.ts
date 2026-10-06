/**
 * Factory KPIs (roadmap Phase 79, docs/autonomous-factory.md §14.2). Pure: the morning report
 * computes them from the local ledger, /agent-performance from `agent_jobs` rows.
 *
 * The number the project optimises is overnight yield: human-approved PRs per night the
 * factory ran. The rest explain it: what each accepted PR cost in free requests, how often you
 * accept, how much review it needed, and how much ran without your intervention.
 */
import type { ModelTier } from './model-router'

export interface JobRecord {
  id: string
  startedAt: Date
  tier: ModelTier
  status: 'verified' | 'failed' | 'rate_limited'
  prUrl: string | null
  /** How the PR ended after your review. */
  outcome: 'merged' | 'rejected' | null
  resolvedAt: Date | null
  /** Commits you pushed onto the PR beyond the factory's one; null = unknown (older jobs). */
  humanCommits: number | null
  /** Model requests the builder spent; null = not tracked (older jobs). */
  requests: number | null
  /** Alias of the adversarial reviewer, if one ran (a free-agent review costs one free request). */
  adversaryModel: string | null
}

export interface FactoryKpis {
  windowDays: number
  /** Distinct factory nights (07:00–07:00) with at least one attempt. */
  nights: number
  prsOpened: number
  merged: number
  closed: number
  /** Merged PRs per night the factory ran. The headline. */
  overnightYield: number | null
  /** PRs opened in the most recent factory night. */
  lastNightPrs: number
  /** merged ÷ (merged + closed). */
  acceptance: number | null
  /** Free-cloud requests (M1 builds + free-agent reviews) on jobs where requests were tracked. */
  freeRequests: number
  /** Merged PRs per 100 free requests (only jobs with tracked requests). */
  acceptedPer100FreeRequests: number | null
  /** Median hours from PR opened to your merge/close. */
  reviewHoursMedian: number | null
  /** Merged PRs you had to edit first. */
  humanEditedPrs: number
  /** Merged without your edits ÷ (every resolved PR + every approval request). */
  autonomy: number | null
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The factory's day runs 07:00–07:00 local (after the morning report), so a night is one day. */
export function factoryNight(d: Date, dayStartHour = 7): string {
  return new Date(d.getTime() - dayStartHour * HOUR).toLocaleDateString('en-CA')
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function computeFactoryKpis(
  jobs: JobRecord[], now: Date, opts: { windowDays?: number; approvalsNeeded?: number; dayStartHour?: number } = {},
): FactoryKpis {
  const windowDays = opts.windowDays ?? 30
  const inWindow = jobs.filter(j => now.getTime() - j.startedAt.getTime() <= windowDays * DAY && j.status !== 'rate_limited')
  const nightsRan = new Set(inWindow.map(j => factoryNight(j.startedAt, opts.dayStartHour)))
  const prs = inWindow.filter(j => j.prUrl)
  const merged = prs.filter(j => j.outcome === 'merged')
  const closed = prs.filter(j => j.outcome === 'rejected')
  const lastNight = [...nightsRan].sort().at(-1)

  const tracked = inWindow.filter(j => j.requests !== null)
  const freeRequests = tracked.reduce((n, j) => n + (j.tier === 'M1' ? j.requests ?? 0 : 0) + (j.adversaryModel?.startsWith('free-agent') ? 1 : 0), 0)
  const trackedMerged = tracked.filter(j => j.outcome === 'merged').length

  const resolved = [...merged, ...closed]
  const untouched = merged.filter(j => (j.humanCommits ?? 0) === 0).length

  return {
    windowDays,
    nights: nightsRan.size,
    prsOpened: prs.length,
    merged: merged.length,
    closed: closed.length,
    overnightYield: nightsRan.size ? merged.length / nightsRan.size : null,
    lastNightPrs: lastNight ? prs.filter(j => factoryNight(j.startedAt, opts.dayStartHour) === lastNight).length : 0,
    acceptance: ratio(merged.length, merged.length + closed.length),
    freeRequests,
    acceptedPer100FreeRequests: freeRequests > 0 ? (trackedMerged / freeRequests) * 100 : null,
    reviewHoursMedian: median(resolved.filter(j => j.resolvedAt).map(j => (j.resolvedAt!.getTime() - j.startedAt.getTime()) / HOUR)),
    humanEditedPrs: merged.length - untouched,
    autonomy: ratio(untouched, resolved.length + (opts.approvalsNeeded ?? 0)),
  }
}

/** An `agent_jobs` row (as Drizzle returns it) → KPI input. */
export function jobRecordFromRow(r: {
  id: string; startedAt: Date; tier: string; status: string; prUrl: string | null; outcome: string | null
  resolvedAt: Date | null; humanCommits: number | null; requests: number | null; adversaryModel: string | null
}): JobRecord {
  return {
    id: r.id, startedAt: r.startedAt, tier: r.tier as ModelTier,
    status: r.status === 'verified' || r.status === 'rate_limited' ? r.status : 'failed',
    prUrl: r.prUrl, outcome: r.outcome === 'merged' || r.outcome === 'rejected' ? r.outcome : null,
    resolvedAt: r.resolvedAt, humanCommits: r.humanCommits, requests: r.requests, adversaryModel: r.adversaryModel,
  }
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)

/** One-line summary for the morning report headline and the page. */
export function kpiHeadline(k: FactoryKpis): string {
  const y = k.overnightYield === null ? 'no nights yet' : `${k.overnightYield.toFixed(1)} approved PRs/night over ${k.nights} night(s)`
  const eff = k.acceptedPer100FreeRequests === null ? '' : ` · ${k.acceptedPer100FreeRequests.toFixed(1)} merged per 100 free requests`
  return `Overnight yield: ${y} · acceptance ${pct(k.acceptance)} · autonomy ${pct(k.autonomy)}${eff}`
}
