import { describe, it, expect } from 'vitest'
import { computePortfolioEvents, computeInternalDeps } from '@/lib/health/events'

// ─── computePortfolioEvents ───────────────────────────────────────────────────

describe('computePortfolioEvents', () => {
  const base = {
    isNew: false,
    existingMrr: 0,
    newMrr: 0,
    existingIsArchived: false,
    oldHealthScore: 50,
    newHealthScore: 50,
  }

  it('emits repo_created for a new repo with dedup key', () => {
    const events = computePortfolioEvents(1, 'my-repo', 'A cool repo', false, { ...base, isNew: true })
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('repo_created')
    expect(events[0].dedupKey).toBe('repo_created:1')
    expect(events[0].description).toBe('A cool repo')
  })

  it('does not emit repo_created for an existing repo', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, base)
    expect(events.map(e => e.eventType)).not.toContain('repo_created')
  })

  it('emits repo_archived when isArchived flips true', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, true, base)
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('repo_archived')
    expect(events[0].dedupKey).toBe('repo_archived:1')
  })

  it('does not emit repo_archived when already archived', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, true, { ...base, existingIsArchived: true })
    expect(events.map(e => e.eventType)).not.toContain('repo_archived')
  })

  it('emits first_revenue when MRR goes from 0 to positive', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, newMrr: 50 })
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('first_revenue')
    expect(events[0].dedupKey).toBe('first_revenue:1')
  })

  it('does not emit first_revenue when existing MRR is already positive', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, existingMrr: 50, newMrr: 100 })
    expect(events.map(e => e.eventType)).not.toContain('first_revenue')
  })

  it('emits mrr_changed when MRR increases by >= $10', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, existingMrr: 100, newMrr: 150 })
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('mrr_changed')
    expect(events[0].dedupKey).toBeUndefined()
    expect(events[0].metadata).toEqual({ from: 100, to: 150 })
  })

  it('emits mrr_changed when MRR decreases by >= $10', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, existingMrr: 200, newMrr: 100 })
    expect(events[0].eventType).toBe('mrr_changed')
    expect(events[0].title).toContain('decreased')
  })

  it('does not emit mrr_changed for small changes under $10', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, existingMrr: 100, newMrr: 105 })
    expect(events.map(e => e.eventType)).not.toContain('mrr_changed')
  })

  it('does not emit mrr_changed for new repos', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, {
      isNew: true, existingMrr: 0, newMrr: 200, existingIsArchived: false, oldHealthScore: 0, newHealthScore: 50,
    })
    // Only repo_created should fire; MRR is a new repo's initial state
    expect(events.map(e => e.eventType)).not.toContain('mrr_changed')
  })

  it('emits health_milestone when health crosses 70', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, oldHealthScore: 65, newHealthScore: 72 })
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('health_milestone')
    expect(events[0].dedupKey).toBe('health_milestone:1:70')
    expect((events[0].metadata as { threshold: number }).threshold).toBe(70)
  })

  it('emits health_milestone when health crosses 80', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, oldHealthScore: 78, newHealthScore: 83 })
    expect(events[0].dedupKey).toBe('health_milestone:1:80')
  })

  it('emits health_milestone when health crosses 90', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, oldHealthScore: 88, newHealthScore: 92 })
    expect(events[0].dedupKey).toBe('health_milestone:1:90')
  })

  it('emits multiple health milestones when jumping over two thresholds', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, oldHealthScore: 65, newHealthScore: 95 })
    const types = events.filter(e => e.eventType === 'health_milestone')
    expect(types).toHaveLength(3)
    const keys = types.map(e => e.dedupKey)
    expect(keys).toContain('health_milestone:1:70')
    expect(keys).toContain('health_milestone:1:80')
    expect(keys).toContain('health_milestone:1:90')
  })

  it('does not emit health_milestone when score stays below threshold', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, oldHealthScore: 60, newHealthScore: 68 })
    expect(events.map(e => e.eventType)).not.toContain('health_milestone')
  })

  it('does not emit health_milestone when score was already above threshold', () => {
    const events = computePortfolioEvents(1, 'my-repo', null, false, { ...base, oldHealthScore: 85, newHealthScore: 88 })
    expect(events.map(e => e.eventType)).not.toContain('health_milestone')
  })

  it('emits nothing when nothing changed', () => {
    expect(computePortfolioEvents(1, 'my-repo', null, false, base)).toHaveLength(0)
  })
})

// ─── computeInternalDeps ──────────────────────────────────────────────────────

describe('computeInternalDeps', () => {
  it('detects when one repo depends on another', () => {
    const result = computeInternalDeps([
      { repoId: 1, repoName: 'ui-kit', packageName: 'my-ui-kit', depNames: [] },
      { repoId: 2, repoName: 'app', packageName: 'my-app', depNames: ['my-ui-kit', 'react'] },
    ])
    expect(result.get(2)).toEqual(['my-ui-kit'])
    expect(result.get(1)).toEqual([])
  })

  it('excludes self-references', () => {
    const result = computeInternalDeps([
      { repoId: 1, repoName: 'app', packageName: 'my-app', depNames: ['my-app', 'react'] },
    ])
    expect(result.get(1)).toEqual([])
  })

  it('handles multiple internal dependencies', () => {
    const result = computeInternalDeps([
      { repoId: 1, repoName: 'lib-a', packageName: 'lib-a', depNames: [] },
      { repoId: 2, repoName: 'lib-b', packageName: 'lib-b', depNames: [] },
      { repoId: 3, repoName: 'app', packageName: 'my-app', depNames: ['lib-a', 'lib-b', 'react'] },
    ])
    expect(result.get(3)).toEqual(['lib-a', 'lib-b'])
    expect(result.get(1)).toEqual([])
    expect(result.get(2)).toEqual([])
  })

  it('returns empty deps for repos with no matching packages', () => {
    const result = computeInternalDeps([
      { repoId: 1, repoName: 'app', packageName: 'my-app', depNames: ['react', 'next'] },
      { repoId: 2, repoName: 'api', packageName: 'my-api', depNames: ['express'] },
    ])
    expect(result.get(1)).toEqual([])
    expect(result.get(2)).toEqual([])
  })

  it('handles repos with no package name', () => {
    const result = computeInternalDeps([
      { repoId: 1, repoName: 'lib', packageName: null, depNames: [] },
      { repoId: 2, repoName: 'app', packageName: 'my-app', depNames: ['lib'] },
    ])
    // repo 1 has no packageName so can't be depended on by name
    expect(result.get(2)).toEqual([])
  })

  it('returns all repos in the result map', () => {
    const result = computeInternalDeps([
      { repoId: 1, repoName: 'a', packageName: 'pkg-a', depNames: [] },
      { repoId: 2, repoName: 'b', packageName: 'pkg-b', depNames: ['pkg-a'] },
    ])
    expect(result.has(1)).toBe(true)
    expect(result.has(2)).toBe(true)
  })
})
