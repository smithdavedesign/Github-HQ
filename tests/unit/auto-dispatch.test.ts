/**
 * Phase 53 — Auto-dispatch filter logic unit tests.
 * Tests the pure filter rules without DB or Nexus calls.
 */
import { describe, it, expect } from 'vitest'
import type { AccuracyStats } from '../../src/lib/actions/advisor-accuracy'
import type { AutoDispatchSettings } from '../../src/lib/actions/nexus'
import { MIN_DATA_POINTS } from '../../src/lib/actions/advisor-accuracy-utils'

// ─── Mirror of autoDispatchAdvisorActions filter logic ───────────────────────

type Effort = 'quick' | 'medium' | 'substantial'
type ImpactType = 'opportunity' | 'revenue' | 'security' | 'health'

interface MockAction { repoName: string; effort: Effort; impactType: ImpactType }

function shouldDispatch(
  action: MockAction,
  settings: AutoDispatchSettings,
  accuracyStats: AccuracyStats[],
): { dispatch: boolean; reason?: string } {
  // 1. Effort gate
  if (action.effort === 'substantial' && settings.autoDispatchEffortGate !== 'all') {
    return { dispatch: false, reason: 'substantial effort blocked by gate' }
  }
  if (action.effort === 'medium' && settings.autoDispatchEffortGate === 'quick_only') {
    return { dispatch: false, reason: 'medium effort blocked by quick_only gate' }
  }

  // 2. Security gate
  if (action.impactType === 'security' && settings.autoDispatchSkipSecurity) {
    return { dispatch: false, reason: 'security skipped' }
  }

  // 3. Accuracy gate
  if (settings.autoDispatchAccuracyThreshold > 0) {
    const stat = accuracyStats.find(s => s.impactType === action.impactType)
    const minPts = MIN_DATA_POINTS[action.impactType] ?? 3
    if (stat && stat.dataPoints >= minPts && stat.successRate < settings.autoDispatchAccuracyThreshold) {
      return { dispatch: false, reason: `accuracy ${stat.successRate}% < threshold ${settings.autoDispatchAccuracyThreshold}%` }
    }
  }

  return { dispatch: true }
}

const DEFAULT_SETTINGS: AutoDispatchSettings = {
  autoDispatchEnabled:           true,
  autoDispatchEffortGate:        'quick_only',
  autoDispatchMaxPerRun:         3,
  autoDispatchSkipSecurity:      true,
  autoDispatchAccuracyThreshold: 0,
}

const mockAccuracy = (impactType: string, successRate: number, dataPoints: number): AccuracyStats => ({
  impactType: impactType as ImpactType,
  successRate,
  dataPoints,
  avgActualDelta: 5,
  hasSignal: dataPoints >= (MIN_DATA_POINTS[impactType as ImpactType] ?? 3),
  timeDecayedRate: successRate,
})

// ─── Effort gate tests ────────────────────────────────────────────────────────

describe('effort gate', () => {
  it('dispatches quick actions with quick_only gate', () => {
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'health' }, DEFAULT_SETTINGS, [])
    expect(result.dispatch).toBe(true)
  })

  it('blocks medium actions with quick_only gate', () => {
    const result = shouldDispatch({ repoName: 'r', effort: 'medium', impactType: 'health' }, DEFAULT_SETTINGS, [])
    expect(result.dispatch).toBe(false)
    expect(result.reason).toContain('medium')
  })

  it('dispatches medium actions with quick_and_medium gate', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchEffortGate: 'quick_and_medium' }
    const result = shouldDispatch({ repoName: 'r', effort: 'medium', impactType: 'health' }, settings, [])
    expect(result.dispatch).toBe(true)
  })

  it('blocks substantial actions with quick_and_medium gate', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchEffortGate: 'quick_and_medium' }
    const result = shouldDispatch({ repoName: 'r', effort: 'substantial', impactType: 'health' }, settings, [])
    expect(result.dispatch).toBe(false)
  })

  it('dispatches substantial actions with all gate', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchEffortGate: 'all' }
    const result = shouldDispatch({ repoName: 'r', effort: 'substantial', impactType: 'health' }, settings, [])
    expect(result.dispatch).toBe(true)
  })
})

// ─── Security gate tests ──────────────────────────────────────────────────────

describe('security gate', () => {
  it('blocks security actions when skipSecurity is true', () => {
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'security' }, DEFAULT_SETTINGS, [])
    expect(result.dispatch).toBe(false)
    expect(result.reason).toContain('security')
  })

  it('dispatches security actions when skipSecurity is false', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchSkipSecurity: false }
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'security' }, settings, [])
    expect(result.dispatch).toBe(true)
  })

  it('does not block non-security actions when skipSecurity is true', () => {
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'health' }, DEFAULT_SETTINGS, [])
    expect(result.dispatch).toBe(true)
  })
})

// ─── Accuracy gate tests ──────────────────────────────────────────────────────

describe('accuracy gate', () => {
  it('dispatches when threshold is 0 (disabled)', () => {
    const stats = [mockAccuracy('health', 20, 10)]  // very low accuracy
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'health' }, DEFAULT_SETTINGS, stats)
    expect(result.dispatch).toBe(true)
  })

  it('blocks when accuracy below threshold and sufficient data', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchAccuracyThreshold: 80 }
    const stats = [mockAccuracy('health', 60, 5)]  // 60% < 80% threshold, 5 pts ≥ MIN
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'health' }, settings, stats)
    expect(result.dispatch).toBe(false)
    expect(result.reason).toContain('accuracy')
  })

  it('dispatches when accuracy meets threshold', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchAccuracyThreshold: 80 }
    const stats = [mockAccuracy('health', 85, 5)]  // 85% > 80%
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'health' }, settings, stats)
    expect(result.dispatch).toBe(true)
  })

  it('dispatches when insufficient data (below MIN_DATA_POINTS)', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchAccuracyThreshold: 80 }
    const stats = [mockAccuracy('health', 20, 1)]  // only 1 data point, not enough signal
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'health' }, settings, stats)
    expect(result.dispatch).toBe(true)  // not enough data to block
  })

  it('dispatches when no accuracy data exists for this impactType', () => {
    const settings = { ...DEFAULT_SETTINGS, autoDispatchAccuracyThreshold: 80 }
    const result = shouldDispatch({ repoName: 'r', effort: 'quick', impactType: 'revenue' }, settings, [])
    expect(result.dispatch).toBe(true)  // no data = no block
  })
})

// ─── Combined filter tests ────────────────────────────────────────────────────

describe('combined filter — max per run', () => {
  it('stops at maxPerRun even if more actions are eligible', () => {
    const actions: MockAction[] = [
      { repoName: 'a', effort: 'quick', impactType: 'health' },
      { repoName: 'b', effort: 'quick', impactType: 'health' },
      { repoName: 'c', effort: 'quick', impactType: 'health' },
      { repoName: 'd', effort: 'quick', impactType: 'health' },
    ]
    const settings = { ...DEFAULT_SETTINGS, autoDispatchMaxPerRun: 2 }
    let queued = 0
    for (const action of actions) {
      if (queued >= settings.autoDispatchMaxPerRun) break
      const r = shouldDispatch(action, settings, [])
      if (r.dispatch) queued++
    }
    expect(queued).toBe(2)
  })
})
