import { describe, it, expect } from 'vitest'
import {
  calculateOpportunityScore,
  calculateRevenuePotential,
  calculateTrafficScore,
  opportunityLabel,
  type OpportunityInputs,
} from '@/lib/health/scoring'

const base: OpportunityInputs = {
  healthScore: 70,
  activityScore: 50,
  stars: 10,
  mrr: 0,
  isRevenueGenerating: false,
  hasLiveDeployment: false,
}

describe('calculateRevenuePotential', () => {
  it('returns 0 for a dormant repo with no stars or deployment', () => {
    expect(calculateRevenuePotential(0, 0, false, 0)).toBe(0)
  })

  it('activity contributes when no revenue or stars', () => {
    const score = calculateRevenuePotential(0, 0, false, 100)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(30)
  })

  it('live deployment adds 30 points to proxy', () => {
    const without = calculateRevenuePotential(0, 0, false, 0)
    const withDeploy = calculateRevenuePotential(0, 0, true, 0)
    expect(withDeploy - without).toBe(30)
  })

  it('stars cap at 40 points for proxy repos', () => {
    const manyStars = calculateRevenuePotential(0, 1000, false, 0)
    expect(manyStars).toBeLessThanOrEqual(40)
  })

  it('uses log scale for MRR repos', () => {
    const low = calculateRevenuePotential(10, 0, false, 0)
    const mid = calculateRevenuePotential(100, 0, false, 0)
    const high = calculateRevenuePotential(1000, 0, false, 0)
    expect(low).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
    expect(high).toBeLessThanOrEqual(100)
  })

  it('$10k MRR hits the cap at 100', () => {
    expect(calculateRevenuePotential(10_000, 0, false, 0)).toBe(100)
  })

  it('ignores stars/deployment when MRR > 0', () => {
    const mrrOnly = calculateRevenuePotential(100, 0, false, 0)
    const mrrWithExtras = calculateRevenuePotential(100, 500, true, 100)
    expect(mrrOnly).toBe(mrrWithExtras)
  })
})

describe('calculateTrafficScore', () => {
  it('returns 0 for 0 stars', () => {
    expect(calculateTrafficScore(0)).toBe(0)
  })

  it('returns > 0 for any stars', () => {
    expect(calculateTrafficScore(1)).toBeGreaterThan(0)
  })

  it('is monotonically increasing', () => {
    const s1 = calculateTrafficScore(5)
    const s10 = calculateTrafficScore(10)
    const s100 = calculateTrafficScore(100)
    expect(s10).toBeGreaterThan(s1)
    expect(s100).toBeGreaterThan(s10)
  })

  it('caps at 100 for very high star counts', () => {
    expect(calculateTrafficScore(500)).toBe(100)
    expect(calculateTrafficScore(10_000)).toBe(100)
  })

  it('500+ stars = max score', () => {
    expect(calculateTrafficScore(500)).toBe(calculateTrafficScore(5000))
  })
})

describe('calculateOpportunityScore', () => {
  it('returns a number between 0 and 100', () => {
    const score = calculateOpportunityScore(base)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns an integer', () => {
    expect(Number.isInteger(calculateOpportunityScore(base))).toBe(true)
  })

  it('a fully dead repo scores near 0', () => {
    const dead: OpportunityInputs = {
      healthScore: 0, activityScore: 0, stars: 0,
      mrr: 0, isRevenueGenerating: false, hasLiveDeployment: false,
    }
    expect(calculateOpportunityScore(dead)).toBe(0)
  })

  it('a perfect healthy revenue-generating repo scores high', () => {
    const perfect: OpportunityInputs = {
      healthScore: 100, activityScore: 100, stars: 500,
      mrr: 10_000, isRevenueGenerating: true, hasLiveDeployment: true,
    }
    expect(calculateOpportunityScore(perfect)).toBe(100)
  })

  it('revenue is most impactful factor (30% weight)', () => {
    const noRevenue = calculateOpportunityScore({ ...base, mrr: 0 })
    const withRevenue = calculateOpportunityScore({ ...base, mrr: 1000 })
    expect(withRevenue).toBeGreaterThan(noRevenue)
  })

  it('health score contributes 25%', () => {
    const lowHealth = calculateOpportunityScore({ ...base, healthScore: 0 })
    const highHealth = calculateOpportunityScore({ ...base, healthScore: 100 })
    // Difference should be ~25 points (100 * 0.25)
    expect(highHealth - lowHealth).toBeCloseTo(25, 0)
  })

  it('activity contributes 25%', () => {
    const noActivity = calculateOpportunityScore({ ...base, activityScore: 0, mrr: 0, stars: 0 })
    const fullActivity = calculateOpportunityScore({ ...base, activityScore: 100, mrr: 0, stars: 0 })
    // Activity affects both activityScore weight (25%) and revenue proxy (30% * 0.3 = 9%)
    expect(fullActivity).toBeGreaterThan(noActivity)
  })

  it('stars matter via traffic score (20% weight)', () => {
    const noStars = calculateOpportunityScore({ ...base, stars: 0, mrr: 0 })
    const manyStars = calculateOpportunityScore({ ...base, stars: 500, mrr: 0 })
    expect(manyStars).toBeGreaterThan(noStars)
  })

  it('is deterministic for same inputs', () => {
    expect(calculateOpportunityScore(base)).toBe(calculateOpportunityScore(base))
  })
})

describe('opportunityLabel', () => {
  it('labels high scores as High', () => {
    expect(opportunityLabel(80)).toBe('High')
    expect(opportunityLabel(100)).toBe('High')
  })

  it('labels mid scores as Medium', () => {
    expect(opportunityLabel(55)).toBe('Medium')
    expect(opportunityLabel(79)).toBe('Medium')
  })

  it('labels low scores as Low', () => {
    expect(opportunityLabel(0)).toBe('Low')
    expect(opportunityLabel(54)).toBe('Low')
  })
})
