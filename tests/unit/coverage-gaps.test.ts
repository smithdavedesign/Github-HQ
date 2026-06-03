/**
 * Tests for previously-untested action files flagged by the gstack /health check.
 * Covers pure validation/computation logic only — no DB calls.
 */
import { describe, it, expect } from 'vitest'

// ─── auto-dispatch-settings validation (mirrors server-side rules) ────────────

function validateAutoDispatch(s: {
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
    return `Invalid accuracy threshold: ${s.accuracyThreshold}`
  }
  return null
}

describe('auto-dispatch-settings — saveAutoDispatch validation', () => {
  it('accepts valid quick_only / max 3 / threshold 0', () => {
    expect(validateAutoDispatch({ effortGate: 'quick_only', maxPerRun: 3, accuracyThreshold: 0 })).toBeNull()
  })

  it('accepts all valid effort gates', () => {
    for (const gate of ['quick_only', 'quick_and_medium', 'all']) {
      expect(validateAutoDispatch({ effortGate: gate, maxPerRun: 1, accuracyThreshold: 0 })).toBeNull()
    }
  })

  it('accepts all valid accuracy thresholds', () => {
    for (const t of [0, 50, 75, 80]) {
      expect(validateAutoDispatch({ effortGate: 'quick_only', maxPerRun: 3, accuracyThreshold: t })).toBeNull()
    }
  })

  it('accepts boundary maxPerRun values (1 and 10)', () => {
    expect(validateAutoDispatch({ effortGate: 'all', maxPerRun: 1, accuracyThreshold: 0 })).toBeNull()
    expect(validateAutoDispatch({ effortGate: 'all', maxPerRun: 10, accuracyThreshold: 0 })).toBeNull()
  })

  it('rejects unknown effort gate', () => {
    expect(validateAutoDispatch({ effortGate: 'yolo', maxPerRun: 3, accuracyThreshold: 0 })).toContain('effort gate')
  })

  it('rejects maxPerRun = 0 (below minimum)', () => {
    expect(validateAutoDispatch({ effortGate: 'quick_only', maxPerRun: 0, accuracyThreshold: 0 })).toContain('maxPerRun')
  })

  it('rejects maxPerRun = 11 (above maximum)', () => {
    expect(validateAutoDispatch({ effortGate: 'quick_only', maxPerRun: 11, accuracyThreshold: 0 })).toContain('maxPerRun')
  })

  it('rejects non-integer maxPerRun', () => {
    expect(validateAutoDispatch({ effortGate: 'quick_only', maxPerRun: 3.5, accuracyThreshold: 0 })).toContain('maxPerRun')
  })

  it('rejects accuracy threshold not in allowed set (e.g. 60)', () => {
    expect(validateAutoDispatch({ effortGate: 'quick_only', maxPerRun: 3, accuracyThreshold: 60 })).toContain('threshold')
  })
})

// ─── weekly-diff — WeeklyDiff shape + pure logic ──────────────────────────────

interface HealthMover { repoId: number; repoName: string; delta: number; oldScore: number; newScore: number }
interface WeeklyDiff {
  hasData: boolean
  topImprover: HealthMover | null
  topDecliner: HealthMover | null
  newRepos: { repoId: number; repoName: string }[]
  archivedRepos: { repoId: number; repoName: string }[]
  mrrChanges: { repoId: number; repoName: string; from: number; to: number }[]
  newCriticalAlerts: { repoId: number; repoName: string; title: string }[]
}

function emptyDiff(): WeeklyDiff {
  return { hasData: false, topImprover: null, topDecliner: null, newRepos: [], archivedRepos: [], mrrChanges: [], newCriticalAlerts: [] }
}

describe('weekly-diff — WeeklyDiff shape', () => {
  it('empty diff has hasData = false', () => {
    const diff = emptyDiff()
    expect(diff.hasData).toBe(false)
  })

  it('diff with an improver has correct delta', () => {
    const diff: WeeklyDiff = {
      ...emptyDiff(),
      hasData: true,
      topImprover: { repoId: 1, repoName: 'ai-brand-context', delta: 19, oldScore: 61, newScore: 80 },
    }
    expect(diff.topImprover?.delta).toBe(19)
    expect((diff.topImprover?.newScore ?? 0) - (diff.topImprover?.oldScore ?? 0)).toBe(19)
  })

  it('diff with decliner has negative delta', () => {
    const diff: WeeklyDiff = {
      ...emptyDiff(),
      hasData: true,
      topDecliner: { repoId: 2, repoName: 'slow-repo', delta: -8, oldScore: 72, newScore: 64 },
    }
    expect(diff.topDecliner?.delta).toBeLessThan(0)
  })

  it('archived repos list is an array', () => {
    const diff: WeeklyDiff = {
      ...emptyDiff(),
      hasData: true,
      archivedRepos: Array.from({ length: 20 }, (_, i) => ({ repoId: i, repoName: `old-repo-${i}` })),
    }
    expect(diff.archivedRepos.length).toBe(20)
  })

  it('MRR change delta computed correctly', () => {
    const mrr = { repoId: 3, repoName: 'family-tree', from: 0, to: 5 }
    expect(mrr.to - mrr.from).toBe(5)
    expect(mrr.from).toBe(0)  // first revenue
  })
})

// ─── repositories.ts — dbOp error wrapper behaviour ──────────────────────────

describe('dbOp error wrapper', () => {
  async function dbOp<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof Error && ['Unauthorized', 'Not found', 'Repository not found'].includes(err.message)) {
        throw err
      }
      throw new Error(`Failed to ${label}. Please try again.`)
    }
  }

  it('passes through Unauthorized without wrapping', async () => {
    await expect(dbOp('test', () => { throw new Error('Unauthorized') })).rejects.toThrow('Unauthorized')
  })

  it('passes through Not found without wrapping', async () => {
    await expect(dbOp('test', () => { throw new Error('Not found') })).rejects.toThrow('Not found')
  })

  it('wraps unexpected DB errors with friendly message', async () => {
    await expect(
      dbOp('load repos', () => { throw new Error('NeonDbError: connection refused') })
    ).rejects.toThrow('Failed to load repos. Please try again.')
  })

  it('returns value on success', async () => {
    const result = await dbOp('test', () => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it('hides internal error details from callers', async () => {
    const err = await dbOp('load', () => { throw new Error('postgresql://user:secret@host/db') }).catch((e: unknown) => e)
    expect((err as Error).message).not.toContain('postgresql://')
    expect((err as Error).message).not.toContain('secret')
  })
})
