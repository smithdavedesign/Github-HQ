import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run } from './proc'
import { emitEvent } from '../system/events'

/**
 * GitHub Copilot premium-request quota. The Copilot CLI and Copilot code review both spend
 * premium requests; when the monthly allowance is gone (and overage is off) they fail with
 * "You have no quota" until the reset date. Read via the endpoint Copilot's own clients use
 * (unofficial — callers treat null as "unknown" and fall back to error detection).
 */
export interface CopilotQuota {
  plan: string | null
  percentRemaining: number
  overagePermitted: boolean
  resetDate: string | null
}

export function parseCopilotQuota(body: unknown): CopilotQuota | null {
  const d = body as {
    copilot_plan?: string
    quota_reset_date?: string
    quota_snapshots?: { premium_interactions?: { percent_remaining?: number; overage_permitted?: boolean; unlimited?: boolean } }
  }
  const p = d?.quota_snapshots?.premium_interactions
  if (!p || typeof p.percent_remaining !== 'number') return null
  return {
    plan: d.copilot_plan ?? null,
    percentRemaining: p.unlimited ? 100 : p.percent_remaining,
    overagePermitted: p.overage_permitted === true,
    resetDate: d.quota_reset_date ?? null,
  }
}

/** Premium requests can be spent right now. */
export function copilotHasQuota(q: CopilotQuota | null): boolean {
  return q === null || q.percentRemaining > 0 || q.overagePermitted
}

export async function copilotQuota(): Promise<CopilotQuota | null> {
  // Copilot belongs to your own account: ask with your gh login, not the factory's scoped
  // GH_TOKEN (factory.sh), which can't read this endpoint. A failed check reads as "has quota".
  const r = await run('gh', ['api', '/copilot_internal/user'], { timeoutMs: 30_000, env: { GH_TOKEN: '' } })
  if (r.code !== 0) return null
  try {
    return parseCopilotQuota(JSON.parse(r.output))
  } catch {
    return null
  }
}

/**
 * Copilot usage for RepoHQ's Agents page (the Copilot card): the premium-request quota plus the
 * factory's Copilot tasks and reviews today against their caps. Published to the system log as
 * factory/copilot/usage; the page reads the latest one.
 */
export interface CopilotUsageData {
  installed: boolean
  plan: string | null
  /** Null when the quota couldn't be read (unofficial endpoint, or Copilot not installed). */
  percentRemaining: number | null
  overagePermitted: boolean | null
  resetDate: string | null
  tasksToday: number
  maxTasksPerDay: number
  reviewsToday: number
  maxReviewsPerDay: number
}

export function copilotUsageData(
  quota: CopilotQuota | null, usage: { copilotTasks: number; copilotReviews: number },
  caps: { maxTasksPerDay: number; maxReviewsPerDay: number }, installed: boolean,
): CopilotUsageData {
  return {
    installed, plan: quota?.plan ?? null, percentRemaining: quota?.percentRemaining ?? null,
    overagePermitted: quota ? quota.overagePermitted : null, resetDate: quota?.resetDate ?? null,
    tasksToday: usage.copilotTasks, maxTasksPerDay: caps.maxTasksPerDay, reviewsToday: usage.copilotReviews, maxReviewsPerDay: caps.maxReviewsPerDay,
  }
}

export function copilotUsageMessage(d: CopilotUsageData): string {
  const quota = !d.installed ? 'Copilot CLI not installed'
    : d.percentRemaining === null ? 'premium-request quota unknown'
    : `${Math.round(d.percentRemaining)}% of premium requests left${d.resetDate ? ` (resets ${d.resetDate})` : ''}${d.percentRemaining <= 0 && d.overagePermitted ? ', overage on' : ''}`
  return `Copilot${d.plan ? ` ${d.plan}` : ''}: ${quota}; factory used ${d.tasksToday}/${d.maxTasksPerDay} tasks and ${d.reviewsToday}/${d.maxReviewsPerDay} reviews today`
}

/** Emit the snapshot when it changed since the last one (or always, with `force`). Returns whether it emitted. */
export function publishCopilotUsage(home: string, d: CopilotUsageData, { force = false, emit = emitEvent }: { force?: boolean; emit?: typeof emitEvent } = {}): boolean {
  const file = path.join(home, 'copilot-usage.json')
  const key = JSON.stringify(d)
  let last: string | null = null
  try { last = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { key?: string }).key ?? null : null } catch { /* rewrite it */ }
  if (!force && last === key) return false
  emit({ system: 'factory', component: 'copilot', event: 'usage', status: 'info', message: copilotUsageMessage(d), data: { ...d } })
  try { writeFileSync(file, JSON.stringify({ key, at: new Date().toISOString() })) } catch { /* best-effort */ }
  return true
}
