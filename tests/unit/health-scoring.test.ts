import { describe, it, expect } from 'vitest'
import { calculateHealthScore, healthColor, healthLabel } from '@/lib/health/scoring'

describe('calculateHealthScore', () => {
  it('returns 100 for a perfect repo', () => {
    const score = calculateHealthScore({
      activityScore: 100,
      securityScore: 100,
      documentationScore: 100,
      testingScore: 100,
      dependencyScore: 100,
      qualityScore: 100,
      deploymentScore: 100,
    })
    expect(score).toBe(100)
  })

  it('returns 0 for a completely dead repo', () => {
    const score = calculateHealthScore({
      activityScore: 0,
      securityScore: 0,
      documentationScore: 0,
      testingScore: 0,
      dependencyScore: 0,
      qualityScore: 0,
      deploymentScore: 0,
    })
    expect(score).toBe(0)
  })

  it('applies correct weights (security 20%, activity 20%)', () => {
    // Only security is 100, everything else 0
    const securityOnly = calculateHealthScore({
      activityScore: 0,
      securityScore: 100,
      documentationScore: 0,
      testingScore: 0,
      dependencyScore: 0,
      qualityScore: 0,
      deploymentScore: 0,
    })
    expect(securityOnly).toBe(20)

    // Only activity is 100, everything else 0
    const activityOnly = calculateHealthScore({
      activityScore: 100,
      securityScore: 0,
      documentationScore: 0,
      testingScore: 0,
      dependencyScore: 0,
      qualityScore: 0,
      deploymentScore: 0,
    })
    expect(activityOnly).toBe(20)
  })

  it('applies correct weight for deployment (15%)', () => {
    const score = calculateHealthScore({
      activityScore: 0,
      securityScore: 0,
      documentationScore: 0,
      testingScore: 0,
      dependencyScore: 0,
      qualityScore: 0,
      deploymentScore: 100,
    })
    expect(score).toBe(15)
  })

  it('uses 50 as default deployment score when not provided', () => {
    const withDefault = calculateHealthScore({
      activityScore: 0,
      securityScore: 0,
      documentationScore: 0,
      testingScore: 0,
      dependencyScore: 0,
      qualityScore: 0,
    })
    // 50 * 0.15 = 7.5, rounded to 8
    expect(withDefault).toBe(8)
  })

  it('defaults null sub-scores sensibly', () => {
    const score = calculateHealthScore({
      activityScore: null,
      securityScore: null,
      documentationScore: null,
      testingScore: null,
      dependencyScore: null,
      qualityScore: null,
    })
    // activity=0*0.20=0, security=100*0.20=20, deployment=50*0.15=7.5,
    // docs=0*0.15=0, testing=0*0.10=0, dependency=50*0.10=5, quality=70*0.10=7 → 39.5 → 40
    expect(score).toBe(40)
  })

  it('rounds to nearest integer', () => {
    const score = calculateHealthScore({
      activityScore: 33,
      securityScore: 33,
      documentationScore: 33,
      testingScore: 33,
      dependencyScore: 33,
      qualityScore: 33,
      deploymentScore: 33,
    })
    expect(Number.isInteger(score)).toBe(true)
  })
})

describe('healthColor', () => {
  it('returns green for score >= 90', () => {
    expect(healthColor(90)).toBe('green')
    expect(healthColor(100)).toBe('green')
    expect(healthColor(95)).toBe('green')
  })

  it('returns yellow for score 70-89', () => {
    expect(healthColor(70)).toBe('yellow')
    expect(healthColor(89)).toBe('yellow')
    expect(healthColor(75)).toBe('yellow')
  })

  it('returns red for score < 70', () => {
    expect(healthColor(0)).toBe('red')
    expect(healthColor(69)).toBe('red')
    expect(healthColor(50)).toBe('red')
  })
})

describe('healthLabel', () => {
  it('labels healthy repos correctly', () => {
    expect(healthLabel(90)).toBe('Healthy')
    expect(healthLabel(100)).toBe('Healthy')
  })

  it('labels at-risk repos correctly', () => {
    expect(healthLabel(70)).toBe('At Risk')
    expect(healthLabel(89)).toBe('At Risk')
  })

  it('labels dead repos correctly', () => {
    expect(healthLabel(0)).toBe('Dead')
    expect(healthLabel(69)).toBe('Dead')
  })
})
