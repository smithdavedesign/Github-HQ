import { describe, it, expect } from 'vitest'
import {
  calculateArchiveScore,
  archiveLabel,
  calculateTimeAllocation,
  type TimeAllocationInput,
} from '@/lib/health/scoring'

const baseInputs = {
  quarterlyCommits: 0,
  mrr: 0,
  hasLiveDeployment: false,
  healthScore: 20,
  opportunityScore: 20,
  daysSinceLastPush: 400,
  isArchived: false,
}

describe('calculateArchiveScore', () => {
  it('returns 0 for already-archived repos', () => {
    expect(calculateArchiveScore({ ...baseInputs, isArchived: true })).toBe(0)
  })

  it('returns high score for totally inactive repo with no revenue', () => {
    const score = calculateArchiveScore(baseInputs)
    expect(score).toBeGreaterThanOrEqual(70)
  })

  it('caps score at 30 for repos with MRR > 0', () => {
    const score = calculateArchiveScore({ ...baseInputs, mrr: 500 })
    expect(score).toBeLessThanOrEqual(30)
  })

  it('returns low score for active repo with revenue and deployment', () => {
    const score = calculateArchiveScore({
      quarterlyCommits: 50,
      mrr: 1000,
      hasLiveDeployment: true,
      healthScore: 85,
      opportunityScore: 80,
      daysSinceLastPush: 3,
      isArchived: false,
    })
    expect(score).toBeLessThan(20)
  })

  it('handles zero daysSinceLastPush gracefully', () => {
    const score = calculateArchiveScore({ ...baseInputs, daysSinceLastPush: 0, quarterlyCommits: 20 })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('archiveLabel', () => {
  it('returns Strong for score >= 70', () => {
    expect(archiveLabel(70)).toBe('Strong')
    expect(archiveLabel(90)).toBe('Strong')
  })

  it('returns Moderate for score 45-69', () => {
    expect(archiveLabel(45)).toBe('Moderate')
    expect(archiveLabel(65)).toBe('Moderate')
  })

  it('returns Unlikely for score < 45', () => {
    expect(archiveLabel(0)).toBe('Unlikely')
    expect(archiveLabel(44)).toBe('Unlikely')
  })
})

describe('calculateTimeAllocation', () => {
  const makeRepo = (overrides: Partial<TimeAllocationInput>): TimeAllocationInput => ({
    repoId: 1,
    repoName: 'test-repo',
    healthScore: 50,
    opportunityScore: 50,
    estimatedValue: 10000,
    mrr: 0,
    hasLiveDeployment: false,
    activityScore: 50,
    archiveScore: 0,
    isFocused: false,
    ...overrides,
  })

  it('filters out strong archive candidates (score >= 70)', () => {
    const repos = [
      makeRepo({ repoId: 1, repoName: 'archived-cand', archiveScore: 75, healthScore: 10, opportunityScore: 10 }),
      makeRepo({ repoId: 2, repoName: 'active-repo', archiveScore: 30, healthScore: 60, opportunityScore: 60 }),
    ]
    const result = calculateTimeAllocation(repos, 5)
    expect(result.map(r => r.repoId)).not.toContain(1)
    expect(result.map(r => r.repoId)).toContain(2)
  })

  it('applies 2.5x multiplier for revenue repos (mrr > 0)', () => {
    const repos = [
      makeRepo({ repoId: 10, mrr: 500, healthScore: 50, opportunityScore: 50 }),
      makeRepo({ repoId: 11, mrr: 0, healthScore: 50, opportunityScore: 50 }),
    ]
    const result = calculateTimeAllocation(repos, 2)
    expect(result[0].repoId).toBe(10)
  })

  it('applies 1.2x focus bonus', () => {
    const repos = [
      makeRepo({ repoId: 20, isFocused: true, healthScore: 50, opportunityScore: 50 }),
      makeRepo({ repoId: 21, isFocused: false, healthScore: 50, opportunityScore: 50 }),
    ]
    const result = calculateTimeAllocation(repos, 2)
    expect(result[0].repoId).toBe(20)
  })

  it('respects topN limit', () => {
    const repos = Array.from({ length: 10 }, (_, i) =>
      makeRepo({ repoId: i, repoName: `repo-${i}`, healthScore: 80 - i, opportunityScore: 80 - i })
    )
    const result = calculateTimeAllocation(repos, 3)
    expect(result).toHaveLength(3)
  })

  it('returns empty array when all repos are archive candidates', () => {
    const repos = [
      makeRepo({ archiveScore: 80 }),
      makeRepo({ archiveScore: 90 }),
    ]
    expect(calculateTimeAllocation(repos, 3)).toHaveLength(0)
  })
})
