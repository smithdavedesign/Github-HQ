import { describe, it, expect } from 'vitest'
import { summarizeFactoryEvents } from '../../src/lib/agents/factory-stats'

const at = (d: string) => new Date(d)
const attempt = (metadata: Record<string, unknown>) => ({ eventType: 'agent_attempt', occurredAt: at('2026-10-05T00:00:00Z'), metadata })

describe('summarizeFactoryEvents', () => {
  it('rolls up factory attempts per tier and ignores other agents', () => {
    const s = summarizeFactoryEvents([
      attempt({ source: 'factory', tier: 'M0', outcome: 'success', resolution: 'merged' }),
      attempt({ source: 'factory', tier: 'M0', outcome: 'failed' }),
      attempt({ source: 'factory', tier: 'M1', outcome: 'success', resolution: 'rejected' }),
      attempt({ source: 'factory', tier: 'M2', outcome: 'success', costUsd: 0.42 }),
      attempt({ agent: 'Claude Code via MCP', outcome: 'success' }),
    ])
    expect(s.rows.find(r => r.tier === 'M0')).toEqual({ tier: 'M0', attempts: 2, verified: 1, merged: 1, rejected: 0, costUsd: 0 })
    expect(s.rows.find(r => r.tier === 'M1')).toMatchObject({ verified: 1, rejected: 1 })
    expect(s.totalAttempts).toBe(4)
    expect(s.freeSharePct).toBe(67)
    expect(s.totalCostUsd).toBeCloseTo(0.42)
  })

  it('returns null free share with no verified fixes and picks the latest scout report', () => {
    const s = summarizeFactoryEvents([
      { eventType: 'model_scout_report', occurredAt: at('2026-10-01T00:00:00Z'), metadata: { source: 'factory', primary: 'old/m:free', backup: null } },
      { eventType: 'model_scout_report', occurredAt: at('2026-10-05T00:00:00Z'), metadata: { source: 'factory', primary: 'new/m:free', backup: 'b/m:free' } },
    ])
    expect(s.freeSharePct).toBeNull()
    expect(s.scout).toMatchObject({ primary: 'new/m:free', backup: 'b/m:free' })
  })

  it('counts sandboxed vs host attempts and reports the latest run', () => {
    const s = summarizeFactoryEvents([
      { eventType: 'agent_attempt', occurredAt: at('2026-10-04T00:00:00Z'), metadata: { source: 'factory', tier: 'M0', outcome: 'failed' } },
      { eventType: 'agent_attempt', occurredAt: at('2026-10-06T00:00:00Z'), metadata: { source: 'factory', tier: 'M1', outcome: 'success', isolation: 'docker' } },
      { eventType: 'agent_attempt', occurredAt: at('2026-10-05T00:00:00Z'), metadata: { source: 'factory', tier: 'M0', outcome: 'success', isolation: 'host' } },
    ])
    expect(s.isolation).toMatchObject({ sandboxed: 1, host: 2, lastIsolation: 'docker' })
    expect(s.isolation.lastAt).toEqual(at('2026-10-06T00:00:00Z'))
  })
})
