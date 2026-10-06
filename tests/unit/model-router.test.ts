import { describe, it, expect } from 'vitest'
import {
  classifyRepoData,
  allowedTiers,
  computeTierStats,
  chooseTier,
  nextTier,
  canUsePaidTier,
  emptyTierStats,
  type AttemptRecord,
  type ModelTier,
} from '../../src/lib/agents/model-router'

const NOW = new Date('2026-10-04T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

function attempts(tier: ModelTier, successes: number, failures: number, kind = 'fix-lint', age = 0): AttemptRecord[] {
  return [
    ...Array.from({ length: successes }, () => ({ taskKind: kind, tier, outcome: 'success' as const, at: daysAgo(age) })),
    ...Array.from({ length: failures }, () => ({ taskKind: kind, tier, outcome: 'failed' as const, at: daysAgo(age) })),
  ]
}

describe('classifyRepoData', () => {
  it('public repos are public', () => {
    expect(classifyRepoData({ visibility: 'public' })).toBe('public')
  })
  it('private and internal repos are private', () => {
    expect(classifyRepoData({ visibility: 'private' })).toBe('private')
    expect(classifyRepoData({ visibility: 'internal' })).toBe('private')
  })
  it('client work and sensitive tag are sensitive even when public', () => {
    expect(classifyRepoData({ visibility: 'public', purpose: 'Client Work' })).toBe('sensitive')
    expect(classifyRepoData({ visibility: 'public', tags: ['Sensitive'] })).toBe('sensitive')
  })
})

describe('allowedTiers', () => {
  it('blocked tasks get no tier', () => {
    expect(allowedTiers({ taskTier: 'blocked', scoped: true }, 'public')).toEqual([])
  })
  it('tier 3 (security) is paid-only', () => {
    expect(allowedTiers({ taskTier: 3, scoped: true }, 'public')).toEqual(['M2'])
  })
  it('scoped public task can use every tier, cheapest first', () => {
    expect(allowedTiers({ taskTier: 1, scoped: true }, 'public')).toEqual(['M0', 'M1', 'MC', 'M2'])
  })
  it('unscoped task skips M0', () => {
    expect(allowedTiers({ taskTier: 2, scoped: false }, 'public')).toEqual(['M1', 'MC', 'M2'])
  })
  it('private repos skip free cloud unless opted in', () => {
    expect(allowedTiers({ taskTier: 2, scoped: true }, 'private')).toEqual(['M0', 'MC', 'M2'])
    expect(allowedTiers({ taskTier: 2, scoped: true }, 'private', { allowFreeCloud: true })).toEqual(['M0', 'M1', 'MC', 'M2'])
  })
  it('sensitive repos never use free cloud or Copilot, even when opted in', () => {
    expect(allowedTiers({ taskTier: 2, scoped: false }, 'sensitive', { allowFreeCloud: true })).toEqual(['M2'])
  })
  it('Copilot tier drops out when disabled or over its daily cap', () => {
    expect(allowedTiers({ taskTier: 2, scoped: false }, 'public', { copilot: false })).toEqual(['M1', 'M2'])
  })
})

describe('computeTierStats', () => {
  it('counts only terminal outcomes for the requested kind', () => {
    const recs: AttemptRecord[] = [
      ...attempts('M1', 3, 1),
      { taskKind: 'fix-lint', tier: 'M1', outcome: 'pending', at: NOW },
      { taskKind: 'fix-lint', tier: 'M1', outcome: 'partial', at: NOW },
      ...attempts('M1', 5, 0, 'docs'),
    ]
    const s = computeTierStats(recs, 'fix-lint', NOW)
    expect(s.M1.attempts).toBe(4)
    expect(s.M1.rate).toBeCloseTo(0.75)
    expect(s.M0).toEqual({ attempts: 0, rate: 0 })
    expect(s.MC).toEqual({ attempts: 0, rate: 0 })
  })
  it('decays old attempts so recent results dominate', () => {
    const recs = [...attempts('M1', 0, 4, 'k', 120), ...attempts('M1', 4, 0, 'k', 0)]
    const s = computeTierStats(recs, 'k', NOW, 30)
    expect(s.M1.attempts).toBe(8)
    expect(s.M1.rate).toBeGreaterThan(0.9)
  })
})

describe('chooseTier', () => {
  const noExplore = () => 0.99
  const explore = () => 0.0

  it('returns null when nothing is allowed', () => {
    expect(chooseTier({ allowed: [], stats: emptyTierStats() }).tier).toBeNull()
  })
  it('cold-starts on the cheapest allowed tier', () => {
    const d = chooseTier({ allowed: ['M0', 'M1', 'M2'], stats: emptyTierStats(), rand: noExplore })
    expect(d.tier).toBe('M0')
    expect(d.reason).toMatch(/cold start/)
  })
  it('skips a tier that has been disproven', () => {
    const stats = computeTierStats(attempts('M0', 2, 10), 'fix-lint', NOW)
    const d = chooseTier({ allowed: ['M0', 'M1', 'M2'], stats, rand: noExplore })
    expect(d.tier).toBe('M1')
  })
  it('picks the cheapest proven tier', () => {
    const stats = computeTierStats([...attempts('M1', 9, 1), ...attempts('M2', 10, 0)], 'fix-lint', NOW)
    const d = chooseTier({ allowed: ['M1', 'M2'], stats, rand: noExplore })
    expect(d).toMatchObject({ tier: 'M1', exploring: false })
  })
  it('explores one tier cheaper than the proven tier', () => {
    const stats = computeTierStats(attempts('M2', 10, 0), 'fix-lint', NOW)
    const d = chooseTier({ allowed: ['M0', 'M1', 'M2'], stats, rand: explore })
    expect(d).toMatchObject({ tier: 'M1', exploring: true })
  })
  it('never explores below the cheapest allowed tier', () => {
    const stats = computeTierStats(attempts('M1', 10, 0), 'fix-lint', NOW)
    const d = chooseTier({ allowed: ['M1', 'M2'], stats, rand: explore })
    expect(d).toMatchObject({ tier: 'M1', exploring: false })
  })
  it('falls back to the strongest tier when every tier has data and none is proven', () => {
    const stats = computeTierStats([...attempts('M1', 5, 5), ...attempts('M2', 6, 4)], 'fix-lint', NOW)
    const d = chooseTier({ allowed: ['M1', 'M2'], stats, rand: noExplore })
    expect(d.tier).toBe('M2')
  })
  it('respects config overrides', () => {
    const stats = computeTierStats(attempts('M0', 2, 0), 'fix-lint', NOW)
    const d = chooseTier({ allowed: ['M0', 'M1'], stats, rand: noExplore, config: { minAttempts: 2 } })
    expect(d).toMatchObject({ tier: 'M0', exploring: false })
  })
})

describe('nextTier', () => {
  it('climbs the ladder within the allowed set', () => {
    expect(nextTier('M0', ['M0', 'M1', 'M2'])).toBe('M1')
    expect(nextTier('M1', ['M0', 'M1', 'MC', 'M2'])).toBe('MC')
    expect(nextTier('M0', ['M0', 'M2'])).toBe('M2')
    expect(nextTier('M2', ['M0', 'M1', 'M2'])).toBeNull()
    expect(nextTier('M1', ['M0'])).toBeNull()
  })
})

describe('canUsePaidTier', () => {
  it('is never allowed with a zero budget', () => {
    expect(canUsePaidTier({ monthToDateUsd: 0, monthlyBudgetUsd: 0 }, 0)).toBe(false)
  })
  it('allows spend within budget and blocks overruns', () => {
    expect(canUsePaidTier({ monthToDateUsd: 3, monthlyBudgetUsd: 10 }, 2)).toBe(true)
    expect(canUsePaidTier({ monthToDateUsd: 9.5, monthlyBudgetUsd: 10 }, 1)).toBe(false)
  })
})
