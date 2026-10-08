import { run } from './proc'

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
