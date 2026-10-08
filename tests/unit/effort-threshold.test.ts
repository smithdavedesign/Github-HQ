import { describe, it, expect } from 'vitest'
import { ABSOLUTE_HIGH_OPPORTUNITY, getQuadrant, highOpportunityThreshold } from '../../src/lib/effort'

describe('highOpportunityThreshold', () => {
  it('uses the top quarter of the portfolio (the 2026-10 audit: max 31, median 14)', () => {
    const scores = [31, 31, 29, 29, 29, 26, 20, 18, 18, 16, 14, 14, 14, 12, 10, 8, 6, 4, 2, 0]
    expect(highOpportunityThreshold(scores)).toBe(29)
    expect(getQuadrant(31, 'low', 29).name).toBe('Quick Win')
    expect(getQuadrant(31, 'medium', 29).name).toBe('Invest')
    expect(getQuadrant(14, 'medium', 29).name).toBe('Deprioritize')
  })
  it('never calls near-zero scores high', () => {
    expect(highOpportunityThreshold([3, 2, 2, 1])).toBe(10)
  })
  it('never needs more than the absolute bar', () => {
    expect(highOpportunityThreshold([90, 85, 80, 75, 70])).toBe(ABSOLUTE_HIGH_OPPORTUNITY)
  })
  it('falls back to the absolute bar with no scores', () => {
    expect(highOpportunityThreshold([])).toBe(ABSOLUTE_HIGH_OPPORTUNITY)
    expect(highOpportunityThreshold([0, 0, NaN])).toBe(ABSOLUTE_HIGH_OPPORTUNITY)
  })
  it('getQuadrant keeps the old fixed bar by default', () => {
    expect(getQuadrant(49, 'low').name).toBe('Fill-In')
    expect(getQuadrant(50, 'low').name).toBe('Quick Win')
  })
})
