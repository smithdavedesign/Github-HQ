import { describe, expect, it } from 'vitest'
import { calculateHealthScore, securityScoreFromAlerts } from '../../src/lib/health/scoring'
import { buildHealthTrendSeries } from '../../src/lib/health/history'

const none = { critical: 0, high: 0, medium: 0, low: 0, secrets: 0 }

describe('security score from alerts', () => {
  it('is 100 with no alerts and falls smoothly, never to 0', () => {
    expect(securityScoreFromAlerts(none)).toBe(100)
    expect(securityScoreFromAlerts({ ...none, medium: 1 })).toBe(89)
    expect(securityScoreFromAlerts({ ...none, critical: 1 })).toBe(73)
    expect(securityScoreFromAlerts({ ...none, critical: 3, high: 11 })).toBe(35)
    expect(securityScoreFromAlerts({ ...none, critical: 2, high: 75 })).toBe(15)
    expect(securityScoreFromAlerts({ ...none, critical: 50, high: 500 })).toBeGreaterThan(0)
  })
  it('tells 7 alerts from 77, so fixing half shows as progress', () => {
    const seven = securityScoreFromAlerts({ ...none, high: 7 })
    const half = securityScoreFromAlerts({ ...none, high: 38 })
    const all = securityScoreFromAlerts({ ...none, high: 77 })
    expect(seven).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(all)
  })
  it('counts a secret alert like a high', () => {
    expect(securityScoreFromAlerts({ ...none, secrets: 1 })).toBe(securityScoreFromAlerts({ ...none, high: 1 }))
  })
})

describe('unknown security', () => {
  const base = { activityScore: 80, documentationScore: 80, testingScore: 80, dependencyScore: 80, qualityScore: 80, deploymentScore: 80 }
  it('is left out of health instead of counting as a perfect 100', () => {
    expect(calculateHealthScore({ ...base, securityScore: null })).toBe(80)
    expect(calculateHealthScore({ ...base, securityScore: 100 })).toBe(84)
    expect(calculateHealthScore({ ...base, securityScore: 40 })).toBe(72)
  })
  it('is left out of the portfolio security average', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    const [point] = buildHealthTrendSeries([
      { date: '2026-10-08', healthScore: 60, securityScore: 50, activityScore: 10 },
      { date: '2026-10-08', healthScore: 80, securityScore: null, activityScore: 30 },
    ], 1, now)
    expect(point).toMatchObject({ avgHealth: 70, avgSecurity: 50, avgActivity: 20 })
  })
})
