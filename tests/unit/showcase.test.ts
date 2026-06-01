import { describe, it, expect } from 'vitest'
import { calculateShowcaseScore, getShowcaseRecommendations } from '@/lib/health/showcase'
import type { ShowcaseInput } from '@/lib/health/showcase'

const base = (overrides: Partial<ShowcaseInput> = {}): ShowcaseInput => ({
  id: 1,
  name: 'my-repo',
  description: 'A great project',
  visibility: 'public',
  stars: 0,
  healthScore: 80,
  isFocused: false,
  hasDeployment: false,
  purpose: null,
  lifecycleStatus: 'production',
  activityStatus: 'Actively Maintained',
  language: 'TypeScript',
  ...overrides,
})

describe('calculateShowcaseScore', () => {
  it('returns 0 for private repos', () => {
    expect(calculateShowcaseScore(base({ visibility: 'private' }))).toBe(0)
  })

  it('returns 0 for archived repos', () => {
    expect(calculateShowcaseScore(base({ lifecycleStatus: 'archived' }))).toBe(0)
    expect(calculateShowcaseScore(base({ lifecycleStatus: 'sunsetting' }))).toBe(0)
  })

  it('score increases with higher health', () => {
    const low  = calculateShowcaseScore(base({ healthScore: 30 }))
    const high = calculateShowcaseScore(base({ healthScore: 90 }))
    expect(high).toBeGreaterThan(low)
  })

  it('score increases with stars up to the log-scale cap', () => {
    const no    = calculateShowcaseScore(base({ stars: 0 }))
    const some  = calculateShowcaseScore(base({ stars: 10 }))
    const more  = calculateShowcaseScore(base({ stars: 100 }))
    expect(some).toBeGreaterThan(no)
    expect(more).toBeGreaterThan(some)
    // Stars cap out — 500 and 100 may score the same (that's expected)
    const cap1 = calculateShowcaseScore(base({ stars: 200 }))
    const cap2 = calculateShowcaseScore(base({ stars: 1000 }))
    expect(cap2).toBeGreaterThanOrEqual(cap1)
  })

  it('score increases when repo is focused', () => {
    const unfocused = calculateShowcaseScore(base({ isFocused: false }))
    const focused   = calculateShowcaseScore(base({ isFocused: true }))
    expect(focused).toBeGreaterThan(unfocused)
  })

  it('score increases when repo has a deployment', () => {
    const noDeploy = calculateShowcaseScore(base({ hasDeployment: false }))
    const deployed = calculateShowcaseScore(base({ hasDeployment: true }))
    expect(deployed).toBeGreaterThan(noDeploy)
  })

  it('Portfolio purpose scores higher than Infrastructure', () => {
    const portfolio = calculateShowcaseScore(base({ purpose: 'Portfolio' }))
    const infra     = calculateShowcaseScore(base({ purpose: 'Infrastructure' }))
    expect(portfolio).toBeGreaterThan(infra)
  })

  it('score is between 0 and 100', () => {
    const perfect = calculateShowcaseScore(base({ healthScore: 100, stars: 1000, isFocused: true, hasDeployment: true, purpose: 'Portfolio' }))
    const minimal = calculateShowcaseScore(base({ healthScore: 0 }))
    expect(perfect).toBeLessThanOrEqual(100)
    expect(minimal).toBeGreaterThanOrEqual(0)
  })
})

describe('calculateShowcaseScore — Reference purpose', () => {
  it('returns 0 for Reference repos — not meant to be showcased', () => {
    expect(calculateShowcaseScore(base({ purpose: 'Reference' }))).toBe(0)
  })

  it('Reference scores lower than any other active purpose', () => {
    const reference = calculateShowcaseScore(base({ purpose: 'Reference' }))
    const infra = calculateShowcaseScore(base({ purpose: 'Infrastructure' }))
    expect(reference).toBeLessThanOrEqual(infra)
  })
})

describe('getShowcaseRecommendations', () => {
  it('returns up to topN repos', () => {
    const repos = Array.from({ length: 10 }, (_, i) => base({ id: i, name: `repo-${i}`, stars: i * 10 }))
    const result = getShowcaseRecommendations(repos, 6)
    expect(result.length).toBeLessThanOrEqual(6)
  })

  it('excludes private and archived repos', () => {
    const repos = [
      base({ id: 1, name: 'private', visibility: 'private' }),
      base({ id: 2, name: 'archived', lifecycleStatus: 'archived' }),
      base({ id: 3, name: 'good' }),
    ]
    const result = getShowcaseRecommendations(repos)
    expect(result.map(r => r.name)).toContain('good')
    expect(result.map(r => r.name)).not.toContain('private')
    expect(result.map(r => r.name)).not.toContain('archived')
  })

  it('returns repos sorted by showcase score descending', () => {
    const repos = [
      base({ id: 1, name: 'low',  healthScore: 20 }),
      base({ id: 2, name: 'high', healthScore: 95, isFocused: true, hasDeployment: true }),
      base({ id: 3, name: 'mid',  healthScore: 60 }),
    ]
    const result = getShowcaseRecommendations(repos)
    expect(result[0].name).toBe('high')
    expect(result[result.length - 1].name).toBe('low')
  })
})
