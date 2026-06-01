import { describe, it, expect } from 'vitest'
import { computeOpportunityCost } from '@/lib/health/opportunity-cost'
import type { CostInput } from '@/lib/health/opportunity-cost'

const repo = (overrides: Partial<CostInput> = {}): CostInput => ({
  id: 1,
  name: 'my-repo',
  opportunityScore: 50,
  weeklyCommits: 0,
  mrr: 0,
  isFocused: false,
  lifecycleStatus: 'production',
  ...overrides,
})

describe('computeOpportunityCost', () => {
  it('reports no cost when no commits were made', () => {
    const result = computeOpportunityCost([repo({ weeklyCommits: 0 })])
    expect(result.workedOn).toHaveLength(0)
    expect(result.hasSignificantCost).toBe(false)
  })

  it('identifies repos worked on vs missed', () => {
    const repos = [
      repo({ id: 1, name: 'worked',  weeklyCommits: 5, opportunityScore: 30 }),
      repo({ id: 2, name: 'missed-high', weeklyCommits: 0, opportunityScore: 80 }),
      repo({ id: 3, name: 'missed-low',  weeklyCommits: 0, opportunityScore: 20 }),
    ]
    const result = computeOpportunityCost(repos)
    expect(result.workedOn.map(r => r.name)).toContain('worked')
    expect(result.topMissed[0].name).toBe('missed-high')
  })

  it('marks significant cost when delta >= 10', () => {
    const repos = [
      repo({ id: 1, weeklyCommits: 3, opportunityScore: 20 }),
      repo({ id: 2, weeklyCommits: 0, opportunityScore: 80 }),
    ]
    const result = computeOpportunityCost(repos)
    expect(result.scoreDelta).toBeGreaterThanOrEqual(10)
    expect(result.hasSignificantCost).toBe(true)
  })

  it('no significant cost when worked repos have high opportunity', () => {
    const repos = [
      repo({ id: 1, weeklyCommits: 5, opportunityScore: 80 }),
      repo({ id: 2, weeklyCommits: 0, opportunityScore: 85 }),
    ]
    const result = computeOpportunityCost(repos)
    expect(result.hasSignificantCost).toBe(false)
  })

  it('excludes archived and sunsetting repos', () => {
    const repos = [
      repo({ id: 1, weeklyCommits: 0, opportunityScore: 90, lifecycleStatus: 'archived' }),
      repo({ id: 2, weeklyCommits: 3, opportunityScore: 20, lifecycleStatus: 'production' }),
    ]
    const result = computeOpportunityCost(repos)
    const missedIds = result.topMissed.map(r => r.id)
    expect(missedIds).not.toContain(1)
  })

  it('topMissed returns at most 3 repos sorted by opportunity desc', () => {
    const repos = Array.from({ length: 8 }, (_, i) =>
      repo({ id: i, name: `r${i}`, weeklyCommits: 0, opportunityScore: i * 10 })
    )
    const result = computeOpportunityCost(repos)
    expect(result.topMissed.length).toBeLessThanOrEqual(3)
    if (result.topMissed.length > 1) {
      expect(result.topMissed[0].opportunityScore).toBeGreaterThanOrEqual(result.topMissed[1].opportunityScore)
    }
  })

  it('handles empty repo list gracefully', () => {
    const result = computeOpportunityCost([])
    expect(result.hasSignificantCost).toBe(false)
    expect(result.workedOn).toHaveLength(0)
    expect(result.topMissed).toHaveLength(0)
  })
})
