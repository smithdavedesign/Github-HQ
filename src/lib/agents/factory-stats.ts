/**
 * Pure rollup of autonomous-factory activity mirrored into portfolio_events
 * (`agent_attempt` / `model_scout_report` with metadata.source = 'factory').
 * Rendered on /agent-performance. See docs/autonomous-factory.md §5.
 */
import { TIER_ORDER, type ModelTier } from './model-router'

interface FactoryEventLike {
  eventType: string
  occurredAt: Date
  metadata: unknown
}

interface AttemptMeta {
  source?: string
  tier?: ModelTier
  outcome?: 'success' | 'failed'
  resolution?: 'merged' | 'rejected'
  costUsd?: number
  /** Where the repo's code ran (Phase 76). Older events have none: they ran on the host. */
  isolation?: 'docker' | 'host'
}

interface ScoutMeta {
  source?: string
  primary?: string | null
  backup?: string | null
}

export interface FactoryTierRow {
  tier: ModelTier
  attempts: number
  verified: number
  merged: number
  rejected: number
  costUsd: number
}

export interface FactorySummary {
  rows: FactoryTierRow[]
  totalAttempts: number
  /** Share of verified fixes produced on free tiers (M0 + M1), 0–100; null with no verified fixes. */
  freeSharePct: number | null
  totalCostUsd: number
  /** Attempts whose repo code ran in the Docker sandbox vs on the host. */
  isolation: { sandboxed: number; host: number; lastAt: Date | null; lastIsolation: 'docker' | 'host' | null }
  scout: { primary: string | null; backup: string | null; at: Date } | null
}

export function summarizeFactoryEvents(events: FactoryEventLike[]): FactorySummary {
  const rows: FactoryTierRow[] = TIER_ORDER.map(tier => ({ tier, attempts: 0, verified: 0, merged: 0, rejected: 0, costUsd: 0 }))
  let scout: FactorySummary['scout'] = null
  const isolation: FactorySummary['isolation'] = { sandboxed: 0, host: 0, lastAt: null, lastIsolation: null }

  for (const e of events) {
    if (e.eventType === 'agent_attempt') {
      const m = (e.metadata ?? {}) as AttemptMeta
      if (m.source !== 'factory' || !m.tier) continue
      const row = rows.find(r => r.tier === m.tier)
      if (!row) continue
      row.attempts += 1
      if (m.outcome === 'success') row.verified += 1
      if (m.resolution === 'merged') row.merged += 1
      if (m.resolution === 'rejected') row.rejected += 1
      row.costUsd += m.costUsd ?? 0
      const where = m.isolation === 'docker' ? 'docker' : 'host'
      if (where === 'docker') isolation.sandboxed += 1
      else isolation.host += 1
      if (!isolation.lastAt || e.occurredAt > isolation.lastAt) {
        isolation.lastAt = e.occurredAt
        isolation.lastIsolation = where
      }
    } else if (e.eventType === 'model_scout_report') {
      const m = (e.metadata ?? {}) as ScoutMeta
      if (m.source !== 'factory') continue
      if (!scout || e.occurredAt > scout.at) scout = { primary: m.primary ?? null, backup: m.backup ?? null, at: e.occurredAt }
    }
  }

  const verified = rows.reduce((n, r) => n + r.verified, 0)
  const freeVerified = rows.filter(r => r.tier !== 'M2').reduce((n, r) => n + r.verified, 0)
  return {
    rows,
    totalAttempts: rows.reduce((n, r) => n + r.attempts, 0),
    freeSharePct: verified > 0 ? Math.round((freeVerified / verified) * 100) : null,
    totalCostUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    isolation,
    scout,
  }
}
