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

export type LedgerEntry = AttemptEntry | ResolutionEntry | ScanEntry | ScoutEntry | ApprovalEntry

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

const attemptsOf = (e: LedgerEntry[]) => e.filter((x): x is AttemptEntry => x.type === 'attempt')
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
    if (a.outcome === 'failed' && a.tier !== 'M0' && t >= since) fails.set(key, (fails.get(key) ?? 0) + 1)
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
  const tiers: ModelTier[] = ['M0', 'M1', 'M2']
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
