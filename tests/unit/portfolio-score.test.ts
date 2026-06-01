import { describe, it, expect } from 'vitest'
import { calculatePortfolioScore, portfolioGrade } from '@/lib/health/portfolio-score'
import type { RepoScoreInput } from '@/lib/health/portfolio-score'

const active = (overrides: Partial<RepoScoreInput> = {}): RepoScoreInput => ({
  healthScore: 80,
  activityStatus: 'Actively Maintained',
  mrr: 0,
  isArchived: false,
  lifecycleStatus: 'production',
  ...overrides,
})

describe('calculatePortfolioScore', () => {
  it('returns 0 for empty portfolio', () => {
    expect(calculatePortfolioScore([]).score).toBe(0)
  })

  it('returns 0 for a portfolio of only archived repos', () => {
    const repos = [active({ isArchived: true }), active({ lifecycleStatus: 'archived' })]
    expect(calculatePortfolioScore(repos).score).toBe(0)
  })

  it('score increases with higher average health', () => {
    const lowHealth = calculatePortfolioScore([active({ healthScore: 40 })]).score
    const highHealth = calculatePortfolioScore([active({ healthScore: 90 })]).score
    expect(highHealth).toBeGreaterThan(lowHealth)
  })

  it('score increases when more repos are Actively Maintained', () => {
    const dormant = calculatePortfolioScore([active({ activityStatus: 'Dormant' })]).score
    const active_ = calculatePortfolioScore([active({ activityStatus: 'Actively Maintained' })]).score
    expect(active_).toBeGreaterThan(dormant)
  })

  it('score increases with MRR (up to cap)', () => {
    const noRevenue = calculatePortfolioScore([active({ mrr: 0 })]).score
    const withRevenue = calculatePortfolioScore([active({ mrr: 500 })]).score
    expect(withRevenue).toBeGreaterThan(noRevenue)
  })

  it('revenue score caps at 100 for high MRR', () => {
    const result = calculatePortfolioScore([active({ mrr: 5000 })])
    expect(result.revenueScore).toBe(100)
  })

  it('score includes diversity bonus for productive lifecycle stages', () => {
    const idea = calculatePortfolioScore([active({ lifecycleStatus: 'idea' })]).score
    const prod = calculatePortfolioScore([active({ lifecycleStatus: 'production' })]).score
    expect(prod).toBeGreaterThan(idea)
  })

  it('archived repos are excluded from calculation', () => {
    const withArchived = [active({ healthScore: 100 }), active({ isArchived: true, healthScore: 0 })]
    const without = [active({ healthScore: 100 })]
    expect(calculatePortfolioScore(withArchived).score).toBe(calculatePortfolioScore(without).score)
  })

  it('returns correct breakdown components', () => {
    const repos = [active({ healthScore: 80, activityStatus: 'Actively Maintained', mrr: 0 })]
    const result = calculatePortfolioScore(repos)
    expect(result.avgHealth).toBe(80)
    expect(result.activityRatio).toBe(100)
    expect(result.revenueScore).toBe(0)
    expect(result.diversityScore).toBe(100)
  })

  it('score is between 0 and 100', () => {
    const perfect = calculatePortfolioScore([active({ healthScore: 100, mrr: 2000 })])
    const terrible = calculatePortfolioScore([active({ healthScore: 0, activityStatus: 'Abandoned', lifecycleStatus: 'idea' })])
    expect(perfect.score).toBeLessThanOrEqual(100)
    expect(terrible.score).toBeGreaterThanOrEqual(0)
  })
})

describe('portfolioGrade', () => {
  it('returns A for 85+', () => expect(portfolioGrade(85).grade).toBe('A'))
  it('returns B for 70-84', () => expect(portfolioGrade(75).grade).toBe('B'))
  it('returns C for 55-69', () => expect(portfolioGrade(60).grade).toBe('C'))
  it('returns D for 40-54', () => expect(portfolioGrade(45).grade).toBe('D'))
  it('returns F for <40', () => expect(portfolioGrade(35).grade).toBe('F'))
  it('returns label for each grade', () => {
    expect(portfolioGrade(85).label).toBe('Excellent')
    expect(portfolioGrade(75).label).toBe('Great')
    expect(portfolioGrade(60).label).toBe('Good')
    expect(portfolioGrade(45).label).toBe('Fair')
    expect(portfolioGrade(35).label).toBe('Needs Work')
  })
})
