import { describe, it, expect } from 'vitest'
import { calculateValuation, formatValuation, CONFIDENCE_LABEL, type ValuationInputs } from '@/lib/health/valuation'

const base: ValuationInputs = {
  mrr: 0, stars: 0, healthScore: 70, activityScore: 50,
  hasLiveDeployment: false, isArchived: false, isRevenueGenerating: false,
}

describe('calculateValuation', () => {
  describe('archived repos', () => {
    it('returns zero value and none confidence', () => {
      const result = calculateValuation({ ...base, isArchived: true })
      expect(result.estimatedValue).toBe(0)
      expect(result.valuationConfidence).toBe('none')
      expect(result.valuationMethod).toBe('archived')
    })
  })

  describe('saas_multiple method (revenue repos)', () => {
    it('uses saas_multiple method when MRR > 0', () => {
      const result = calculateValuation({ ...base, mrr: 100 })
      expect(result.valuationMethod).toBe('saas_multiple')
    })

    it('scales value with MRR', () => {
      const low = calculateValuation({ ...base, mrr: 100 })
      const high = calculateValuation({ ...base, mrr: 1000 })
      expect(high.estimatedValue).toBeGreaterThan(low.estimatedValue)
    })

    it('applies confidence tiers correctly', () => {
      expect(calculateValuation({ ...base, mrr: 50 }).valuationConfidence).toBe('very_low')
      expect(calculateValuation({ ...base, mrr: 500 }).valuationConfidence).toBe('low')
      expect(calculateValuation({ ...base, mrr: 3000 }).valuationConfidence).toBe('medium')
    })

    it('higher health score gives higher value (better multiple)', () => {
      const lowHealth = calculateValuation({ ...base, mrr: 500, healthScore: 20 })
      const highHealth = calculateValuation({ ...base, mrr: 500, healthScore: 90 })
      expect(highHealth.estimatedValue).toBeGreaterThan(lowHealth.estimatedValue)
    })

    it('higher activity score gives higher value', () => {
      const dormant = calculateValuation({ ...base, mrr: 500, activityScore: 0 })
      const active = calculateValuation({ ...base, mrr: 500, activityScore: 100 })
      expect(active.estimatedValue).toBeGreaterThan(dormant.estimatedValue)
    })

    it('value is at least MRR × 36 × 0.6 × 0.7 (minimum factors)', () => {
      const result = calculateValuation({ ...base, mrr: 100, healthScore: 0, activityScore: 0 })
      // base_multiple=36, healthFactor=0.6, activityFactor=0.7 → 36*0.6*0.7*100 = 1512
      expect(result.estimatedValue).toBeGreaterThan(1000)
    })

    it('$10k MRR with perfect health/activity gives high valuation', () => {
      const result = calculateValuation({ ...base, mrr: 10000, healthScore: 100, activityScore: 100 })
      // 60 × 1.0 × 1.0 × 10000 = 600000
      expect(result.estimatedValue).toBeGreaterThan(500000)
    })

    it('annualized value reflects MRR × 12', () => {
      const result = calculateValuation({ ...base, mrr: 100 })
      expect(result.annualizedValue).toBe(1200)
    })
  })

  describe('signal_based method (non-revenue repos)', () => {
    it('uses signal_based method when MRR is 0', () => {
      const result = calculateValuation(base)
      expect(result.valuationMethod).toBe('signal_based')
    })

    it('zero stars + no deployment = zero value', () => {
      const result = calculateValuation(base)
      expect(result.estimatedValue).toBe(0)
      expect(result.valuationConfidence).toBe('none')
    })

    it('stars increase value', () => {
      const noStars = calculateValuation(base)
      const stars = calculateValuation({ ...base, stars: 50 })
      expect(stars.estimatedValue).toBeGreaterThan(noStars.estimatedValue)
    })

    it('live deployment adds bonus', () => {
      const noDeploy = calculateValuation({ ...base, stars: 10 })
      const withDeploy = calculateValuation({ ...base, stars: 10, hasLiveDeployment: true })
      expect(withDeploy.estimatedValue).toBeGreaterThan(noDeploy.estimatedValue)
    })

    it('confidence tiers based on stars', () => {
      expect(calculateValuation({ ...base, stars: 0 }).valuationConfidence).toBe('none')
      expect(calculateValuation({ ...base, stars: 5 }).valuationConfidence).toBe('very_low')
      expect(calculateValuation({ ...base, stars: 20 }).valuationConfidence).toBe('very_low')
      expect(calculateValuation({ ...base, stars: 100 }).valuationConfidence).toBe('low')
    })

    it('deployment alone (no stars) gives at least minimum bonus', () => {
      const result = calculateValuation({ ...base, hasLiveDeployment: true })
      // deployBonus = max(500, 0*0.5) = 500; × activity × health floor = 500 * 0.15 * 0.20 = 15
      expect(result.estimatedValue).toBeGreaterThan(0)
    })

    it('annualizedValue is 0 for non-revenue repos', () => {
      const result = calculateValuation({ ...base, stars: 50 })
      expect(result.annualizedValue).toBe(0)
    })
  })

  describe('determinism', () => {
    it('same inputs give same output', () => {
      const a = calculateValuation({ ...base, mrr: 200, stars: 30 })
      const b = calculateValuation({ ...base, mrr: 200, stars: 30 })
      expect(a.estimatedValue).toBe(b.estimatedValue)
    })
  })
})

describe('formatValuation', () => {
  it('formats zero as dash', () => { expect(formatValuation(0)).toBe('—') })
  it('formats small values with $', () => { expect(formatValuation(500)).toBe('$500') })
  it('formats thousands with k', () => { expect(formatValuation(12000)).toBe('$12k') })
  it('formats millions with M', () => { expect(formatValuation(1500000)).toBe('$1.5M') })
  it('rounds thousands to nearest integer', () => { expect(formatValuation(12500)).toBe('$13k') })
})

describe('CONFIDENCE_LABEL', () => {
  it('has labels for all confidence tiers', () => {
    const tiers = ['none', 'very_low', 'low', 'medium', 'high'] as const
    for (const tier of tiers) {
      expect(CONFIDENCE_LABEL[tier]).toBeTruthy()
    }
  })
})
