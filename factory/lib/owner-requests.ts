import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { appendEntry, type AttemptEntry, type LedgerEntry, type OwnerResultEntry } from './ledger'

/**
 * The front door (ai-stack/repohq/CONTRACT.md): OpenClaw turns an owner's plain-words
 * request into a queued task; the factory consumes it through its one governed path
 * (sandbox → free-pool → checks + judge → draft PR) and writes the result back.
 *
 * IN  — <FACTORY_HOME>/queue/owner-requests.jsonl   (OpenClaw appends, we read)
 * OUT — an `owner_result` ledger entry                (we append, OpenClaw's `report` reads)
 *
 * This module is the seam: parsing the queue and deciding which requests are still
 * pending (no terminal result yet). It never writes to the queue — append-only, one writer.
 */

export interface OwnerRequest {
  taskId: string
  repo: string
  task: string
  requestedAt?: string
  source?: string
  thread?: string | null
  status?: string
  /** Agent HQ requests (factory/lib/agent-requests.ts): `report` runs a read-only investigation. JSONL requests are `fix`. */
  mode?: 'fix' | 'report'
  /** The gstack skill an Agent HQ request came from (shapes the prompt). */
  skill?: string
  /** Already an agent_requests row (Agent HQ); JSONL requests are mirrored in when picked up. */
  stored?: boolean
}

export function queuePath(home: string): string {
  return path.join(home, 'queue', 'owner-requests.jsonl')
}

/** All owner requests ever queued (tolerates a torn final line, like the ledger). */
export function readOwnerRequests(home: string): OwnerRequest[] {
  const p = queuePath(home)
  if (!existsSync(p)) return []
  const out: OwnerRequest[] = []
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as OwnerRequest
      if (o && typeof o.taskId === 'string' && typeof o.repo === 'string' && typeof o.task === 'string') out.push(o)
    } catch {
      // skip corrupt line
    }
  }
  return out
}

/** taskIds that already have a terminal result (so they're done — don't re-run them). */
export function resolvedTaskIds(ledger: LedgerEntry[]): Set<string> {
  return new Set(
    ledger.filter((e): e is OwnerResultEntry => e.type === 'owner_result').map(e => e.ownerTaskId),
  )
}

/**
 * Requests still waiting on the factory: queued, not yet resolved. Deduped by repo
 * (one owner task per repo per cycle — the rest wait their turn), newest-last wins
 * so a repo's oldest unresolved request is taken first.
 */
export function pendingOwnerRequests(home: string, ledger: LedgerEntry[]): OwnerRequest[] {
  const done = resolvedTaskIds(ledger)
  const pending = readOwnerRequests(home).filter(r => !done.has(r.taskId))
  const byRepo = new Map<string, OwnerRequest>()
  for (const r of pending) if (!byRepo.has(r.repo)) byRepo.set(r.repo, r) // first (oldest) per repo
  return [...byRepo.values()]
}

/** runLadder's verdict → the status OpenClaw reports back to the owner on WhatsApp. */
export type LadderResult = 'pr' | 'verified' | 'reported' | 'deferred' | 'failed' | 'stop'

/** Terminal outcome of one owner task, for the ledger (OpenClaw) and Agent HQ's agent_requests row. */
export interface OwnerOutcome {
  status: 'pr' | 'verified' | 'reported' | 'rejected' | 'failed'
  prUrl?: string
  reason?: string
  /** report mode: the structured report the investigation produced. */
  findings?: string
}

/**
 * runLadder's verdict → the owner task's terminal outcome; null for `deferred` (free quota ran
 * out this cycle — the request stays pending and the next cycle retries it). prUrl, reason and
 * findings are resolved from the attempt entries this task already wrote to the ledger.
 *
 *   result 'pr'                 → 'pr'       (draft PR opened; prUrl carried through)
 *   result 'verified'           → 'verified' (judge passed but held: stage `report` / dry run)
 *   result 'reported'           → 'reported' (report mode: read-only investigation with findings)
 *   result 'failed' | 'stop'    → 'failed'   (no tier could land it)
 *   anything else (no PR)        → 'rejected' (judge blocked it; reason = its verdict)
 */
export function ownerOutcome(opts: { ownerTaskId: string; result: LadderResult; ledger: LedgerEntry[] }): OwnerOutcome | null {
  if (opts.result === 'deferred') return null
  const mine = opts.ledger.filter(
    (e): e is AttemptEntry => e.type === 'attempt' && e.ownerTaskId === opts.ownerTaskId,
  )
  const withPr = mine.find(a => a.prUrl)
  const last = mine.length > 0 ? mine[mine.length - 1] : null
  const lastReason = last?.reason ?? ''
  if (opts.result === 'reported' && !withPr) {
    const report = [...mine].reverse().find(a => a.findings)
    return { status: 'reported', ...(report?.findings ? { findings: report.findings } : {}), reason: report?.reason ?? lastReason }
  }
  const status: OwnerOutcome['status'] =
    withPr ? 'pr'
      : opts.result === 'verified' ? 'verified'
      : opts.result === 'failed' || opts.result === 'stop' ? 'failed'
      : 'rejected'
  const reason =
    status === 'verified'
      ? "verified, held — owner-requested is at stage 'report' (or a dry run); promote it to 'pr' to open the PR"
      : lastReason || `${opts.result} (no verified change)`
  return { status, ...(withPr?.prUrl ? { prUrl: withPr.prUrl } : {}), ...(status !== 'pr' ? { reason } : {}) }
}

/**
 * Write the terminal `owner_result` the front door reports. `deferred` means free quota
 * ran out this cycle — leave the request pending so the next cycle retries it (returns false,
 * nothing written). Everything else is terminal (see ownerOutcome for the mapping; a report
 * outcome is delivered as `verified`, the closest status OpenClaw knows).
 */
export function recordOwnerResult(
  home: string,
  opts: { ownerTaskId: string; repo: string; runId: string; result: LadderResult; ledger: LedgerEntry[]; now: Date },
): boolean {
  const outcome = ownerOutcome(opts)
  if (!outcome) return false
  const ownerStatus: OwnerResultEntry['ownerStatus'] = outcome.status === 'reported' ? 'verified' : outcome.status
  const entry: OwnerResultEntry = {
    type: 'owner_result', runId: opts.runId, at: opts.now.toISOString(),
    repo: opts.repo, ownerTaskId: opts.ownerTaskId, ownerStatus,
    ...(outcome.prUrl ? { prUrl: outcome.prUrl } : {}),
    ...(outcome.reason && ownerStatus !== 'pr' ? { reason: outcome.reason } : {}),
  }
  appendEntry(home, entry)
  return true
}

/**
 * Why an owner request can't run on a repo the stale-bot-PR rule blocks (`blockOnStaleBotPrs`;
 * `blocked` from rankOpportunities), or null when it can. The rule stops new factory PRs there
 * until the old bot PRs are reviewed or closed, so it only holds back a request that would open
 * one: a fix with `owner-requested` at stage `pr`. A report, or a fix held at stage `report`
 * (or in a dry run), opens no PR and still runs.
 */
export function staleBotPrBlock(req: Pick<OwnerRequest, 'mode'>, blocked: string | null, opensPrs: boolean): string | null {
  if (!blocked || req.mode === 'report' || !opensPrs) return null
  return `no new factory PRs on this repo: ${blocked} — review or close them, then retry the request`
}

/** Terminal result for a request the Director never attempted (open PR / dead end / stale bot PRs). */
export function recordOwnerBlocked(
  home: string,
  opts: { ownerTaskId: string; repo: string; runId: string; reason: string; now: Date },
): void {
  appendEntry(home, {
    type: 'owner_result', runId: opts.runId, at: opts.now.toISOString(),
    repo: opts.repo, ownerTaskId: opts.ownerTaskId, ownerStatus: 'rejected', reason: opts.reason,
  })
}
