/**
 * Model-tier router for the autonomous factory (Phase 63).
 *
 * Pure (no DB, no network) — safe to import from unit tests, server code and
 * the local factory runner (`factory/`). See docs/autonomous-factory.md §3–§5.
 *
 *   M0  Local         Aider → Ollama (Qwen2.5-Coder)                 $0, unlimited
 *   M1  Free cloud    Claude Code → LiteLLM free pool                 $0, rate-limited
 *   MC  Subscription  GitHub Copilot CLI (prepaid seat)               $0 marginal, daily cap
 *   M2  Paid          Claude Code → Anthropic                         $, budget-gated
 */

export type ModelTier = 'M0' | 'M1' | 'MC' | 'M2'

/** Cheapest first. MC is prepaid (Copilot seat): no marginal cost, but its premium requests are finite. */
export const TIER_ORDER: readonly ModelTier[] = ['M0', 'M1', 'MC', 'M2']

/** Task risk tier — mirrors architecture.md "Risk Tiers & Safety Gates". */
export type TaskTier = 1 | 2 | 3 | 'blocked'

export type DataClass = 'public' | 'private' | 'sensitive'

export interface RepoDataInput {
  visibility: string
  purpose?: string | null
  tags?: string[] | null
}

/**
 * Private repos default away from free cloud providers (which may log or train
 * on prompts). Client work, or anything tagged `sensitive`, never goes there.
 */
export function classifyRepoData(repo: RepoDataInput): DataClass {
  const tags = (repo.tags ?? []).map(t => t.toLowerCase())
  if (repo.purpose === 'Client Work' || tags.includes('sensitive')) return 'sensitive'
  return repo.visibility === 'public' ? 'public' : 'private'
}

export interface TaskShape {
  taskTier: TaskTier
  /** True when the change is confined to known file(s) — the only work M0 (7B, 16k ctx) can do. */
  scoped: boolean
}

export interface TierPolicy {
  /** Per-repo opt-in to send private code to free cloud models. Ignored for `sensitive`. */
  allowFreeCloud?: boolean
  /** Copilot tier available (installed + enabled + under its daily cap). Default true. */
  copilot?: boolean
}

/** Tiers a task may run on, before learned stats and budget are considered. Cheapest first. */
export function allowedTiers(task: TaskShape, dataClass: DataClass, policy: TierPolicy = {}): ModelTier[] {
  if (task.taskTier === 'blocked') return []
  // Tier 3 (security) stays on the strongest model until lower tiers prove themselves.
  if (task.taskTier === 3) return ['M2']

  return TIER_ORDER.filter(tier => {
    if (tier === 'M0') return task.scoped
    if (tier === 'M1') {
      if (dataClass === 'public') return true
      if (dataClass === 'private') return policy.allowFreeCloud === true
      return false
    }
    // Copilot is built for private code (no training on it), but sensitive work stays off it.
    if (tier === 'MC') return dataClass !== 'sensitive' && policy.copilot !== false
    return true
  })
}

// ─── Learned stats ───────────────────────────────────────────────────────────

export interface AttemptRecord {
  taskKind: string
  tier: ModelTier
  /** Only terminal outcomes count; pending/partial attempts are ignored. */
  outcome: 'success' | 'failed' | 'partial' | 'pending'
  at: Date
}

export interface TierStats {
  /** Raw count of terminal attempts (used for the min-attempts gate). */
  attempts: number
  /** Time-decayed success rate in [0, 1]; 0 when there are no attempts. */
  rate: number
}

export interface RoutingConfig {
  minSuccessRate: number
  minAttempts: number
  exploreRate: number
  halfLifeDays: number
}

export const ROUTING_DEFAULTS: Readonly<RoutingConfig> = {
  minSuccessRate: 0.8,
  minAttempts: 10,
  exploreRate: 0.1,
  halfLifeDays: 30,
}

export function emptyTierStats(): Record<ModelTier, TierStats> {
  return { M0: { attempts: 0, rate: 0 }, M1: { attempts: 0, rate: 0 }, MC: { attempts: 0, rate: 0 }, M2: { attempts: 0, rate: 0 } }
}

/** Success rate per tier for one task kind, with exponential time decay. */
export function computeTierStats(
  attempts: AttemptRecord[],
  taskKind: string,
  now: Date,
  halfLifeDays: number = ROUTING_DEFAULTS.halfLifeDays,
): Record<ModelTier, TierStats> {
  const acc: Record<ModelTier, { n: number; w: number; ws: number }> = {
    M0: { n: 0, w: 0, ws: 0 }, M1: { n: 0, w: 0, ws: 0 }, MC: { n: 0, w: 0, ws: 0 }, M2: { n: 0, w: 0, ws: 0 },
  }
  for (const a of attempts) {
    if (a.taskKind !== taskKind) continue
    if (a.outcome !== 'success' && a.outcome !== 'failed') continue
    const ageDays = Math.max(0, (now.getTime() - a.at.getTime()) / 86_400_000)
    const weight = Math.pow(0.5, ageDays / halfLifeDays)
    const bucket = acc[a.tier]
    bucket.n += 1
    bucket.w += weight
    if (a.outcome === 'success') bucket.ws += weight
  }
  const out = emptyTierStats()
  for (const tier of TIER_ORDER) {
    const b = acc[tier]
    out[tier] = { attempts: b.n, rate: b.w > 0 ? b.ws / b.w : 0 }
  }
  return out
}

// ─── Decision ────────────────────────────────────────────────────────────────

export interface RouteDecision {
  tier: ModelTier | null
  exploring: boolean
  reason: string
}

interface ChooseTierInput {
  allowed: ModelTier[]
  stats: Record<ModelTier, TierStats>
  /** Injected for deterministic tests; defaults to Math.random. */
  rand?: () => number
  config?: Partial<RoutingConfig>
}

/**
 * Cheapest tier that has *proven* it can do this task kind (≥ minSuccessRate
 * over ≥ minAttempts). Without enough data, start at the cheapest tier that
 * hasn't been *disproven*. A small fraction of proven decisions explore one
 * tier cheaper so the router notices when a free model gets good.
 */
export function chooseTier({ allowed, stats, rand = Math.random, config }: ChooseTierInput): RouteDecision {
  const cfg = { ...ROUTING_DEFAULTS, ...config }
  const ordered = TIER_ORDER.filter(t => allowed.includes(t))
  if (ordered.length === 0) return { tier: null, exploring: false, reason: 'no tier allowed for this task' }

  const hasSignal = (t: ModelTier) => stats[t].attempts >= cfg.minAttempts
  const proven = ordered.filter(t => hasSignal(t) && stats[t].rate >= cfg.minSuccessRate)

  if (proven.length > 0) {
    const best = proven[0]
    const cheaper = ordered.slice(0, ordered.indexOf(best))
    if (cheaper.length > 0 && rand() < cfg.exploreRate) {
      const probe = cheaper[cheaper.length - 1]
      return { tier: probe, exploring: true, reason: `exploring ${probe} (one tier below proven ${best})` }
    }
    return { tier: best, exploring: false, reason: `${best} proven: ${pct(stats[best].rate)} over ${stats[best].attempts}` }
  }

  const notDisproven = ordered.filter(t => !hasSignal(t))
  if (notDisproven.length > 0) {
    const t = notDisproven[0]
    return { tier: t, exploring: false, reason: `cold start on ${t} (${stats[t].attempts}/${cfg.minAttempts} attempts)` }
  }

  // Every allowed tier has data and none clears the bar — use the strongest.
  const strongest = ordered[ordered.length - 1]
  return { tier: strongest, exploring: false, reason: `no tier proven; using strongest allowed (${strongest})` }
}

/** Next (more expensive) allowed tier after a failure, or null at the top of the ladder. */
export function nextTier(current: ModelTier, allowed: ModelTier[]): ModelTier | null {
  const ordered = TIER_ORDER.filter(t => allowed.includes(t))
  const idx = ordered.indexOf(current)
  return idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export interface BudgetState {
  monthToDateUsd: number
  monthlyBudgetUsd: number
}

/** Paid work is never implicit: it needs a positive budget with room for the estimate. */
export function canUsePaidTier(budget: BudgetState, estimateUsd: number): boolean {
  if (budget.monthlyBudgetUsd <= 0) return false
  return budget.monthToDateUsd + Math.max(0, estimateUsd) <= budget.monthlyBudgetUsd
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
