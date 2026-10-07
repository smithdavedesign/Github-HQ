import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AttemptRecord, ModelTier, TaskTier } from '../../src/lib/agents/model-router'
import type { JobRecord } from '../../src/lib/agents/factory-kpis'
import type { AlertCounts, BotPrs, FailingRun } from './sensors'

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
  /** Verified but held back because the capability is at stage `report` (Phase 75): no PR. */
  reported?: boolean
  /** Advisory adversarial review of a verified change (Phase 77). */
  adversary?: { model: string; verdict: 'PASS' | 'FAIL' | 'UNCERTAIN'; issues: number }
  /** red-ci investigations (Phase 78): the model's root-cause report. */
  findings?: string
  /** red-ci: the workflow that was failing (checked again on the PR by reconcile). */
  ciWorkflow?: string
  /** Model requests spent (Phase 79); absent on attempts before request tracking. */
  requests?: number
  /** The failed cheaper-tier attempt this one escalated from (job tree, Phase 79). */
  parentId?: string
  /** Front door: the owner-request (queue taskId) this attempt serves, so results correlate back. */
  ownerTaskId?: string
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
  /** Commits pushed onto the PR beyond the factory's one (human edits before merging). */
  humanCommits?: number
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

/** What the sensors saw for one repo at the start of a cycle (Phase 78). */
export interface SignalsEntry {
  type: 'signals'
  runId: string
  at: string
  repo: string
  /** Branch factory PRs target (integration/agent or the default branch). */
  base: string | null
  /** Workflows whose latest run on `base` failed; null when unknown. */
  redCi: FailingRun[] | null
  alerts: AlertCounts
  botPrs: BotPrs | null
}

/** red-ci PRs: did the workflow that was failing pass on the PR? (the red-ci oracle) */
export interface CiOracleEntry {
  type: 'ci_oracle'
  attemptId: string
  at: string
  workflow: string
  passed: boolean
}

/**
 * Front door terminal result (ai-stack/repohq/CONTRACT.md). Written once per owner-request when
 * its ladder finishes; OpenClaw's `report` reads these to deliver the PR URL (or reason) to WhatsApp.
 */
export interface OwnerResultEntry {
  type: 'owner_result'
  runId: string
  at: string
  repo: string
  /** Correlates back to the queue entry (queue/owner-requests.jsonl). */
  ownerTaskId: string
  /**
   * pr       = draft PR opened.
   * verified = passed the judge but held with no PR (capability at stage `report`, or a dry run).
   * rejected = the judge/checks blocked it.
   * failed   = no tier could attempt it (rate-limited out, or hit the paid-approval boundary).
   */
  ownerStatus: 'pr' | 'verified' | 'rejected' | 'failed'
  prUrl?: string
  reason?: string
}

export type LedgerEntry = AttemptEntry | ResolutionEntry | ScanEntry | ScoutEntry | ApprovalEntry | ReviewEntry | SignalsEntry | CiOracleEntry | OwnerResultEntry

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
    // Deterministic fixes and read-only investigations say nothing about a model's skill as a
    // builder; counting them would credit M0 with npm audit fix's near-100% success. Agent HQ
    // report requests (owner-report) are investigations too, whatever their outcome.
    .filter(a => a.outcome !== 'rate_limited' && a.harness !== 'npm-audit-fix' && a.harness !== 'lint-autofix' && !(a.kind === 'red-ci' && a.findings !== undefined && !a.prUrl) && a.kind !== 'owner-report')
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

/** KPI input (Phase 79): every counted attempt with how its PR ended. */
export function toJobRecords(entries: LedgerEntry[]): JobRecord[] {
  const res = new Map(entries.filter((x): x is ResolutionEntry => x.type === 'resolution').map(r => [r.attemptId, r]))
  return attemptsOf(entries).map(a => {
    const r = res.get(a.id)
    return {
      id: a.id, startedAt: new Date(a.at), tier: a.tier, status: a.outcome, prUrl: a.prUrl ?? null,
      outcome: r?.outcome ?? null, resolvedAt: r ? new Date(r.at) : null, humanCommits: r?.humanCommits ?? null,
      requests: a.requests ?? null, adversaryModel: a.adversary?.model ?? null,
    }
  })
}

/** Latest signals per repo. */
export function latestSignals(entries: LedgerEntry[]): Map<string, SignalsEntry> {
  const by = new Map<string, SignalsEntry>()
  for (const e of entries) if (e.type === 'signals' && (!by.get(e.repo) || e.at > by.get(e.repo)!.at)) by.set(e.repo, e)
  return by
}

/** Open red-ci PRs whose oracle (the failing workflow on the PR) hasn't been recorded yet. */
export function pendingCiOracles(entries: LedgerEntry[]): AttemptEntry[] {
  const done = new Set(entries.filter((e): e is CiOracleEntry => e.type === 'ci_oracle').map(e => e.attemptId))
  return openPrAttempts(entries).filter(a => a.kind === 'red-ci' && !done.has(a.id))
}

/** Open PRs whose requested Copilot review hasn't been recorded yet. */
export function pendingReviews(entries: LedgerEntry[]): AttemptEntry[] {
  const reviewed = new Set(entries.filter((e): e is ReviewEntry => e.type === 'review').map(r => r.attemptId))
  return openPrAttempts(entries).filter(a => a.reviewRequested && !reviewed.has(a.id))
}
