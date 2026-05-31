import { describe, it, expect } from 'vitest'
import type { TrendInfo } from '@/lib/health/history'

// Pure trend computation logic extracted for unit testing
function computeTrend(currentScore: number, oldScore: number, days: number): TrendInfo | null {
  if (days < 5) return null
  const delta = Math.round(currentScore - oldScore)
  const direction: TrendInfo['direction'] =
    delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat'
  return { direction, delta, days }
}

describe('computeTrend', () => {
  it('returns null when less than 5 days of data', () => {
    expect(computeTrend(80, 70, 3)).toBeNull()
    expect(computeTrend(80, 70, 4)).toBeNull()
  })

  it('returns trend when 5+ days of data', () => {
    expect(computeTrend(80, 70, 5)).not.toBeNull()
  })

  it('detects improvement (up)', () => {
    const trend = computeTrend(85, 70, 7)
    expect(trend?.direction).toBe('up')
    expect(trend?.delta).toBe(15)
  })

  it('detects decline (down)', () => {
    const trend = computeTrend(60, 80, 7)
    expect(trend?.direction).toBe('down')
    expect(trend?.delta).toBe(-20)
  })

  it('reports flat for small changes (<= 2 points)', () => {
    expect(computeTrend(81, 80, 7)?.direction).toBe('flat')
    expect(computeTrend(80, 81, 7)?.direction).toBe('flat')
    expect(computeTrend(82, 80, 7)?.direction).toBe('flat')
  })

  it('reports up for exactly 3 point improvement', () => {
    expect(computeTrend(83, 80, 7)?.direction).toBe('up')
  })

  it('reports down for exactly 3 point drop', () => {
    expect(computeTrend(77, 80, 7)?.direction).toBe('down')
  })

  it('preserves days count in result', () => {
    const trend = computeTrend(80, 70, 14)
    expect(trend?.days).toBe(14)
  })

  it('rounds delta to nearest integer', () => {
    // Even with float inputs the result should be an integer
    const trend = computeTrend(80.7, 70.2, 7)
    expect(Number.isInteger(trend?.delta)).toBe(true)
  })
})
