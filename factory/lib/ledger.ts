import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AttemptRecord, ModelTier, TaskTier } from '../../src/lib/agents/model-router'

/**
 * Append-only JSONL ledger at <FACTORY_HOME>/ledger.jsonl — the factory's
 * source of truth for routing stats, spend and PR tracking. RepoHQ gets a
 * mirror via the optional sink, never the other way round.
 */

export interface AttemptEntry {
  type: 'attempt'
  id: string
  runId: string
  at: string
  repo: string
  kind: string
  taskTier: TaskTier
  tier: ModelTier
  model: string
  harness: string
  /** verified = passed checks (PR opened unless dry-run); failed = harness or verification failed. */
  outcome: 'verified' | 'failed' | 'rate_limited'
  reason: string
  exploring: boolean
  durationMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  prUrl?: string
  branch?: string
  /** Copilot code review was requested on the PR. */
  reviewRequested?: boolean
  /** Where the repo's code ran: a Docker sandbox (Phase 76) or the host. Absent on older entries (host). */
  isolation?: 'docker' | 'host'
  /**
   * Set when the verdict itself was wrong (a judge bug, not the model's fault): the attempt
   * stays in the ledger for history but no longer counts for routing, dead ends or stats.
   */
  voided?: string
}

export interface ReviewEntry {
  type: 'review'
  attemptId: string
  at: string
  reviewer: 'copilot'
  /** Inline comments left by the reviewer (0 = clean review). */
  comments: number
  highlights: string[]
}

export interface ResolutionEntry {
  type: 'resolution'
  attemptId: string
  at: string
  /** merged → success; closed without merge → rejected. */
  outcome: 'merged' | 'rejected'
}

export interface ScanEntry {
  type: 'scan'
  runId: string
  at: string
  repo: string
  checks: Record<string, boolean | null>
  tasks: string[]
  /** Checks failing because of the factory's environment (missing secrets / network), not code. */
  envFailures?: string[]
  /** npm audit severity counts (npm repos with a lockfile). */
  audit?: { critical: number; high: number; moderate: number; low: number } | null
}

export interface ScoutEntry {
  type: 'scout'
  at: string
  primary: string | null
  backup: string | null
  scores: { model: string; passes: number; total: number; avgMs: number }[]
}

export interface ApprovalEntry {
  type: 'approval_needed'
  runId: string
  at: string
  repo: string
  kind: string
  reason: string
}

export type LedgerEntry = AttemptEntry | ResolutionEntry | ScanEntry | ScoutEntry | ApprovalEntry | ReviewEntry

export function ledgerPath(home: string): string {
  return path.join(home, 'ledger.jsonl')
}

export function appendEntry(home: string, entry: LedgerEntry): void {
  mkdirSync(home, { recursive: true })
  appendFileSync(ledgerPath(home), JSON.stringify(entry) + '\n')
}

export function readLedger(home: string): LedgerEntry[] {
  const p = ledgerPath(home)
  return existsSync(p) ? parseLedger(readFileSync(p, 'utf8')) : []
}

/** Tolerates a torn final line (crash mid-write). */
export function parseLedger(text: string): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as LedgerEntry)
    } catch {
      // skip corrupt line
    }
  }
  return out
}

/** Attempts that count — voided attempts (judge bugs) are kept for history only. */
const attemptsOf = (e: LedgerEntry[]) => e.filter((x): x is AttemptEntry => x.type === 'attempt' && !x.voided)
const resolutionsOf = (e: LedgerEntry[]) => new Map(e.filter((x): x is ResolutionEntry => x.type === 'resolution').map(r => [r.attemptId, r]))

/**
 * Router input. A verified fix counts as success until a human closes its PR
 * unmerged; rate-limited attempts say nothing about the model's skill.
 */
export function toAttemptRecords(entries: LedgerEntry[]): AttemptRecord[] {
  const res = resolutionsOf(entries)
  return attemptsOf(entries)
    .filter(a => a.outcome !== 'rate_limited')
    .map(a => {
      const r = res.get(a.id)
      const outcome = r ? (r.outcome === 'merged' ? 'success' : 'failed') : a.outcome === 'verified' ? 'success' : 'failed'
      return { taskKind: a.kind, tier: a.tier, outcome, at: new Date(a.at) } satisfies AttemptRecord
    })
}

export function monthToDateUsd(entries: LedgerEntry[], now: Date): number {
  const ym = now.toISOString().slice(0, 7)
  return attemptsOf(entries).filter(a => a.at.startsWith(ym)).reduce((s, a) => s + (a.costUsd || 0), 0)
}

/** Attempts with an open (unresolved) PR. */
export function openPrAttempts(entries: LedgerEntry[]): AttemptEntry[] {
  const res = resolutionsOf(entries)
  return attemptsOf(entries).filter(a => a.prUrl && !res.has(a.id))
}

/**
 * `${repo}:${kind}` pairs that failed ≥ 2 times in the window with no verified fix since.
 * M0 failures don't count: the local model failing is expected and escalates to M1,
 * so it must not lock the task out of the tiers that can actually do it.
 */
export function deadEnds(entries: LedgerEntry[], now: Date, windowDays = 14): Set<string> {
  const since = now.getTime() - windowDays * 86_400_000
  const fails = new Map<string, number>()
  const lastSuccess = new Map<string, number>()
  for (const a of attemptsOf(entries)) {
    const t = new Date(a.at).getTime()
    const key = `${a.repo}:${a.kind}`
    if (a.outcome === 'verified') lastSuccess.set(key, Math.max(lastSuccess.get(key) ?? 0, t))
    // M0 model failures escalate, so they don't count — but deterministic fixes (npm audit fix) never escalate.
    const countsAsDeadEnd = a.tier !== 'M0' || a.harness === 'npm-audit-fix' || a.harness === 'lint-autofix'
    if (a.outcome === 'failed' && countsAsDeadEnd && t >= since) fails.set(key, (fails.get(key) ?? 0) + 1)
  }
  return new Set([...fails.entries()].filter(([k, n]) => n >= 2 && (lastSuccess.get(k) ?? 0) < since).map(([k]) => k))
}

/** Repo scanned least recently first (never-scanned repos first, in allowlist order). */
export function nextRepos(entries: LedgerEntry[], allowlist: string[]): string[] {
  const last = new Map<string, number>()
  for (const e of entries) if (e.type === 'scan') last.set(e.repo, Math.max(last.get(e.repo) ?? 0, new Date(e.at).getTime()))
  return [...allowlist].sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0))
}

export interface TierSummary {
  tier: ModelTier
  attempts: number
  verified: number
  merged: number
  rejected: number
  costUsd: number
}

/** Per-tier rollup for reports: shows the $0 share of verified work. */
export function summarizeByTier(entries: LedgerEntry[]): TierSummary[] {
  const res = resolutionsOf(entries)
  const tiers: ModelTier[] = ['M0', 'M1', 'MC', 'M2']
  return tiers.map(tier => {
    const as = attemptsOf(entries).filter(a => a.tier === tier && a.outcome !== 'rate_limited')
    return {
      tier,
      attempts: as.length,
      verified: as.filter(a => a.outcome === 'verified').length,
      merged: as.filter(a => res.get(a.id)?.outcome === 'merged').length,
      rejected: as.filter(a => res.get(a.id)?.outcome === 'rejected').length,
      costUsd: as.reduce((s, a) => s + (a.costUsd || 0), 0),
    }
  })
}

/** Local calendar day, e.g. "2026-10-05". */
export function localDay(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

/** The factory's day starts after the morning report (07:00 local), so overnight cycles share one cap. */
export const FACTORY_DAY_STARTS_AT_HOUR = 7

export function factoryDay(d: Date, startHour = FACTORY_DAY_STARTS_AT_HOUR): string {
  return localDay(new Date(d.getTime() - startHour * 3_600_000))
}

/** Usage in the current factory day (07:00–07:00 local) that daily caps apply to. */
export function todaysUsage(entries: LedgerEntry[], now: Date): { prs: number; copilotTasks: number; copilotReviews: number } {
  const today = factoryDay(now)
  const as = attemptsOf(entries).filter(a => factoryDay(new Date(a.at)) === today)
  return {
    prs: as.filter(a => a.prUrl).length,
    copilotTasks: as.filter(a => a.tier === 'MC' && a.outcome !== 'rate_limited').length,
    copilotReviews: as.filter(a => a.reviewRequested).length,
  }
}

/** Open PRs whose requested Copilot review hasn't been recorded yet. */
export function pendingReviews(entries: LedgerEntry[]): AttemptEntry[] {
  const reviewed = new Set(entries.filter((e): e is ReviewEntry => e.type === 'review').map(r => r.attemptId))
  return openPrAttempts(entries).filter(a => a.reviewRequested && !reviewed.has(a.id))
}
