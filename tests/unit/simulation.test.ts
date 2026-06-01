import { describe, it, expect } from 'vitest'
import { runSimulation } from '@/lib/health/simulation'
import type { SimulationInput } from '@/lib/health/simulation'

const repo = (overrides: Partial<SimulationInput> = {}): SimulationInput => ({
  repoId: 1,
  repoName: 'my-repo',
  opportunityScore: 50,
  healthScore: 70,
  activityScore: 50,
  mrr: 0,
  isRevenueGenerating: false,
  hasLiveDeployment: false,
  openCriticalFindings: 0,
  estimatedEffort: 'medium',
  lifecycleStatus: 'production',
  isFocused: false,
  withDeploy: 15,
  withSecurity: null,
  withActivity: 10,
  withRevenue: 20,
  ...overrides,
})

describe('runSimulation', () => {
  it('returns empty allocations when no repos have gains', () => {
    const result = runSimulation(
      [repo({ withDeploy: null, withSecurity: null, withActivity: null, withRevenue: null })],
      10, 'max_opportunity', null
    )
    expect(result.allocations).toHaveLength(0)
  })

  it('allocates within the hours budget', () => {
    const repos = Array.from({ length: 5 }, (_, i) => repo({ repoId: i, repoName: `r${i}` }))
    const result = runSimulation(repos, 10, 'max_opportunity', null)
    const used = result.allocations.reduce((s, a) => s + a.estimatedHours, 0)
    expect(used).toBeLessThanOrEqual(10)
  })

  it('picks only one action per repo', () => {
    const result = runSimulation([repo()], 40, 'max_opportunity', null)
    const repoIds = result.allocations.map(a => a.repoId)
    const unique = new Set(repoIds)
    expect(unique.size).toBe(repoIds.length)
  })

  it('skips archived and sunsetting repos', () => {
    const repos = [
      repo({ repoId: 1, lifecycleStatus: 'archived' }),
      repo({ repoId: 2, lifecycleStatus: 'sunsetting' }),
      repo({ repoId: 3, lifecycleStatus: 'production' }),
    ]
    const result = runSimulation(repos, 20, 'max_opportunity', null)
    const ids = result.allocations.map(a => a.repoId)
    expect(ids).not.toContain(1)
    expect(ids).not.toContain(2)
    expect(ids).toContain(3)
  })

  it('projects new portfolio score when current score is provided', () => {
    const result = runSimulation([repo({ withDeploy: 20 })], 10, 'max_opportunity', 70)
    expect(result.newPortfolioScore).not.toBeNull()
    expect(result.newPortfolioScore!).toBeGreaterThan(70)
  })

  it('returns null portfolio score when no current score', () => {
    const result = runSimulation([repo()], 10, 'max_opportunity', null)
    expect(result.newPortfolioScore).toBeNull()
  })

  it('prioritises revenue actions for max_revenue goal', () => {
    const r = repo({ withRevenue: 25, withDeploy: 5, withActivity: 5 })
    const result = runSimulation([r], 40, 'max_revenue', null)
    const types = result.allocations.map(a => a.actionType)
    expect(types).toContain('revenue')
  })

  it('remaining hours reflect unallocated budget', () => {
    const result = runSimulation([repo({ estimatedEffort: 'low', withDeploy: 10 })], 10, 'max_opportunity', null)
    const used = result.allocations.reduce((s, a) => s + a.estimatedHours, 0)
    expect(result.remainingHours).toBeCloseTo(10 - used, 0)
  })

  it('sums total opportunity delta correctly', () => {
    const repos = [
      repo({ repoId: 1, withDeploy: 10, withRevenue: null, withActivity: null, withSecurity: null }),
      repo({ repoId: 2, withDeploy: 15, withRevenue: null, withActivity: null, withSecurity: null }),
    ]
    const result = runSimulation(repos, 40, 'max_opportunity', null)
    expect(result.totalOpportunityDelta).toBeGreaterThanOrEqual(10)
  })
})
