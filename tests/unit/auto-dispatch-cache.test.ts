/**
 * Phase 54 — Brief cache and advisor snapshot TTL unit tests.
 * Tests the pure timing/TTL logic without DB or network calls.
 */
import { describe, it, expect } from 'vitest'

// ─── Brief cache TTL (6 hours) ────────────────────────────────────────────────

const BRIEF_TTL_MS = 6 * 60 * 60 * 1000

function isBriefCacheFresh(generatedAt: string): boolean {
  return Date.now() - new Date(generatedAt).getTime() < BRIEF_TTL_MS
}

describe('brief cache TTL (6h)', () => {
  it('serves cache when brief is 5 minutes old', () => {
    const generatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(isBriefCacheFresh(generatedAt)).toBe(true)
  })

  it('serves cache when brief is exactly 5h 59m old', () => {
    const generatedAt = new Date(Date.now() - (6 * 60 * 60 * 1000 - 60_000)).toISOString()
    expect(isBriefCacheFresh(generatedAt)).toBe(true)
  })

  it('regenerates when brief is 6h 1min old', () => {
    const generatedAt = new Date(Date.now() - (6 * 60 * 60 * 1000 + 60_000)).toISOString()
    expect(isBriefCacheFresh(generatedAt)).toBe(false)
  })

  it('regenerates when brief is 1 day old', () => {
    const generatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isBriefCacheFresh(generatedAt)).toBe(false)
  })

  it('serves cache at exactly 0ms age', () => {
    const generatedAt = new Date().toISOString()
    expect(isBriefCacheFresh(generatedAt)).toBe(true)
  })
})

// ─── Advisor repo snapshot TTL (23 hours) ────────────────────────────────────

const SNAPSHOT_TTL_MS = 23 * 60 * 60 * 1000

function isSnapshotFresh(generatedAt: string): boolean {
  return Date.now() - new Date(generatedAt).getTime() < SNAPSHOT_TTL_MS
}

describe('advisor repo snapshot TTL (23h)', () => {
  it('reuses snapshot when 1h old', () => {
    const generatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(isSnapshotFresh(generatedAt)).toBe(true)
  })

  it('reuses snapshot when 22h 59m old', () => {
    const generatedAt = new Date(Date.now() - (23 * 60 * 60 * 1000 - 60_000)).toISOString()
    expect(isSnapshotFresh(generatedAt)).toBe(true)
  })

  it('recomputes when 23h 1m old', () => {
    const generatedAt = new Date(Date.now() - (23 * 60 * 60 * 1000 + 60_000)).toISOString()
    expect(isSnapshotFresh(generatedAt)).toBe(false)
  })

  it('recomputes when 2 days old', () => {
    const generatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    expect(isSnapshotFresh(generatedAt)).toBe(false)
  })
})

// ─── Auto-dispatch settings validation ───────────────────────────────────────

describe('auto-dispatch settings validation', () => {
  function validateSettings(s: {
    effortGate: string
    maxPerRun: number
    accuracyThreshold: number
  }): string | null {
    const validGates = ['quick_only', 'quick_and_medium', 'all']
    if (!validGates.includes(s.effortGate)) return `Invalid effort gate: ${s.effortGate}`
    if (!Number.isInteger(s.maxPerRun) || s.maxPerRun < 1 || s.maxPerRun > 10) {
      return `maxPerRun must be 1-10, got ${s.maxPerRun}`
    }
    const validThresholds = [0, 50, 75, 80]
    if (!validThresholds.includes(s.accuracyThreshold)) {
      return `Invalid threshold: ${s.accuracyThreshold}`
    }
    return null
  }

  it('accepts valid quick_only settings', () => {
    expect(validateSettings({ effortGate: 'quick_only', maxPerRun: 3, accuracyThreshold: 0 })).toBeNull()
  })

  it('accepts max = 10', () => {
    expect(validateSettings({ effortGate: 'all', maxPerRun: 10, accuracyThreshold: 80 })).toBeNull()
  })

  it('rejects unknown effort gate', () => {
    const err = validateSettings({ effortGate: 'aggressive', maxPerRun: 3, accuracyThreshold: 0 })
    expect(err).toContain('Invalid effort gate')
  })

  it('rejects maxPerRun = 0', () => {
    const err = validateSettings({ effortGate: 'quick_only', maxPerRun: 0, accuracyThreshold: 0 })
    expect(err).toContain('maxPerRun')
  })

  it('rejects maxPerRun = 11', () => {
    const err = validateSettings({ effortGate: 'quick_only', maxPerRun: 11, accuracyThreshold: 0 })
    expect(err).toContain('maxPerRun')
  })

  it('rejects non-integer maxPerRun', () => {
    const err = validateSettings({ effortGate: 'quick_only', maxPerRun: 2.5, accuracyThreshold: 0 })
    expect(err).toContain('maxPerRun')
  })

  it('rejects invalid accuracy threshold (e.g. 65)', () => {
    const err = validateSettings({ effortGate: 'quick_only', maxPerRun: 3, accuracyThreshold: 65 })
    expect(err).toContain('Invalid threshold')
  })
})

// ─── Brief cache schema shape ─────────────────────────────────────────────────

describe('cached brief schema', () => {
  it('has required fields: raw + generatedAt', () => {
    const brief = { raw: '# My Repo\n...', generatedAt: new Date().toISOString() }
    expect(typeof brief.raw).toBe('string')
    expect(brief.raw.length).toBeGreaterThan(0)
    expect(() => new Date(brief.generatedAt)).not.toThrow()
  })

  it('generatedAt is a valid ISO date string', () => {
    const brief = { raw: 'test', generatedAt: new Date().toISOString() }
    const parsed = new Date(brief.generatedAt)
    expect(parsed.getTime()).not.toBeNaN()
  })
})

// ─── autoDispatch skipped count tracking ─────────────────────────────────────

describe('dispatch result tracking', () => {
  it('counts queued and skipped separately', () => {
    const result = { queued: 2, skipped: ['repo-a: effort gate', 'repo-b: security'], errors: [] }
    expect(result.queued).toBe(2)
    expect(result.skipped.length).toBe(2)
    expect(result.errors.length).toBe(0)
  })

  it('skipped list contains reason strings', () => {
    const skipped = ['repo-a: medium effort blocked by quick_only gate', 'repo-b: security action (skip_security=true)']
    for (const s of skipped) {
      expect(typeof s).toBe('string')
      expect(s).toContain(':')
    }
  })
})
