/**
 * Phase 52 — Advisor Learning Loop unit tests.
 * Tests pure logic only — no DB connections required.
 */
import { describe, it, expect } from 'vitest'
import { parsePredictedDelta, MIN_DATA_POINTS } from '../../src/lib/actions/advisor-accuracy-utils'

// ─── parsePredictedDelta ──────────────────────────────────────────────────────

describe('parsePredictedDelta', () => {
  it('extracts positive integer from opportunity string', () => {
    expect(parsePredictedDelta('+14 opportunity points')).toBe(14)
  })

  it('extracts positive integer from pts shorthand', () => {
    expect(parsePredictedDelta('+9 pts')).toBe(9)
  })

  it('extracts number from revenue string', () => {
    expect(parsePredictedDelta('$200/mo MRR')).toBe(200)
  })

  it('extracts negative number', () => {
    expect(parsePredictedDelta('-5 health points')).toBe(-5)
  })

  it('extracts decimal', () => {
    expect(parsePredictedDelta('+3.5 pts')).toBe(3.5)
  })

  it('returns null for empty string', () => {
    expect(parsePredictedDelta('')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parsePredictedDelta(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parsePredictedDelta(undefined)).toBeNull()
  })

  it('returns null for non-numeric string', () => {
    expect(parsePredictedDelta('no numbers here')).toBeNull()
  })
})

// ─── MIN_DATA_POINTS thresholds ───────────────────────────────────────────────

describe('MIN_DATA_POINTS', () => {
  it('security requires more data than health (higher stakes)', () => {
    expect(MIN_DATA_POINTS.security).toBeGreaterThan(MIN_DATA_POINTS.health)
  })

  it('revenue requires the most data (hardest to attribute)', () => {
    const max = Math.max(...Object.values(MIN_DATA_POINTS))
    expect(MIN_DATA_POINTS.revenue).toBe(max)
  })

  it('all thresholds are positive integers', () => {
    for (const [, v] of Object.entries(MIN_DATA_POINTS)) {
      expect(v).toBeGreaterThan(0)
      expect(Number.isInteger(v)).toBe(true)
    }
  })
})

// ─── Accuracy computation logic ───────────────────────────────────────────────
// Tests the algorithmic logic without DB access

describe('directional accuracy definition', () => {
  // Success = actualDelta > 0 (repo improved)
  function isSuccess(actualDelta: number): boolean {
    return actualDelta > 0
  }

  it('positive delta is a success', () => {
    expect(isSuccess(5)).toBe(true)
    expect(isSuccess(1)).toBe(true)
  })

  it('zero delta is not a success', () => {
    expect(isSuccess(0)).toBe(false)
  })

  it('negative delta is not a success', () => {
    expect(isSuccess(-3)).toBe(false)
    expect(isSuccess(-20)).toBe(false)
  })
})

describe('deltaConfidence threshold', () => {
  // Flag low-confidence deltas: swings > 20 pts in either direction
  function confidenceFlag(actualDelta: number): 'high' | 'low' {
    return Math.abs(actualDelta) > 20 ? 'low' : 'high'
  }

  it('small positive delta is high confidence', () => {
    expect(confidenceFlag(5)).toBe('high')
    expect(confidenceFlag(20)).toBe('high')
  })

  it('large positive delta is low confidence (likely other factors)', () => {
    expect(confidenceFlag(21)).toBe('low')
    expect(confidenceFlag(35)).toBe('low')
  })

  it('large negative delta is low confidence', () => {
    expect(confidenceFlag(-21)).toBe('low')
  })

  it('zero delta is high confidence', () => {
    expect(confidenceFlag(0)).toBe('high')
  })
})

describe('time decay weighting', () => {
  // Last 30d count 2x; older count 1x
  function computeDecayedRate(
    recentSuccesses: number,
    recentTotal: number,
    olderSuccesses: number,
    olderTotal: number,
  ): number {
    const weightedSuccesses = recentSuccesses * 2 + olderSuccesses
    const weightedTotal = recentTotal * 2 + olderTotal
    return weightedTotal > 0 ? Math.round((weightedSuccesses / weightedTotal) * 100) : 0
  }

  it('recent performance dominates over historical', () => {
    // Old: 0% (0/5), Recent: 100% (3/3)
    const decayed = computeDecayedRate(3, 3, 0, 5)
    const simple = Math.round((3 / 8) * 100)
    expect(decayed).toBeGreaterThan(simple)
  })

  it('returns 0 with no data', () => {
    expect(computeDecayedRate(0, 0, 0, 0)).toBe(0)
  })

  it('returns 100 when all successes are recent', () => {
    expect(computeDecayedRate(5, 5, 0, 0)).toBe(100)
  })

  it('recent successes count twice as much', () => {
    // 1 recent success, 1 recent total = 2/2 weighted = 100%
    // vs 0 older
    expect(computeDecayedRate(1, 1, 0, 0)).toBe(100)
  })
})

describe('suppress thresholds (risk-adjusted)', () => {
  type ImpactType = 'security' | 'health' | 'opportunity' | 'revenue'
  const THRESHOLDS: Record<ImpactType, { maxFailureRate: number; minAttempts: number }> = {
    security:    { maxFailureRate: 0.70, minAttempts: 5 },
    revenue:     { maxFailureRate: 0.65, minAttempts: 5 },
    health:      { maxFailureRate: 0.60, minAttempts: 3 },
    opportunity: { maxFailureRate: 0.60, minAttempts: 3 },
  }

  function shouldDowngrade(impactType: ImpactType, failureRate: number, attempts: number): boolean {
    const t = THRESHOLDS[impactType]
    return failureRate >= t.maxFailureRate && attempts >= t.minAttempts
  }

  it('security not downgraded below 70% failure rate', () => {
    expect(shouldDowngrade('security', 0.69, 10)).toBe(false)
  })

  it('security downgraded at 70% with enough attempts', () => {
    expect(shouldDowngrade('security', 0.70, 5)).toBe(true)
  })

  it('not downgraded below minimum attempts even with high failure rate', () => {
    expect(shouldDowngrade('security', 0.90, 4)).toBe(false)
    expect(shouldDowngrade('health', 0.80, 2)).toBe(false)
  })

  it('health downgraded at 60% with 3+ attempts', () => {
    expect(shouldDowngrade('health', 0.60, 3)).toBe(true)
  })

  it('security harder to downgrade than health (higher threshold)', () => {
    expect(THRESHOLDS.security.maxFailureRate).toBeGreaterThan(THRESHOLDS.health.maxFailureRate)
  })
})
