import { describe, it, expect } from 'vitest'
import { PLANS, getPlanById, getFreePlan, getPaidPlans } from '@/lib/pricing'

describe('pricing config', () => {
  it('has exactly 3 plans', () => {
    expect(PLANS).toHaveLength(3)
  })

  it('has a free plan with price 0', () => {
    const free = getFreePlan()
    expect(free).toBeDefined()
    expect(free.price).toBe(0)
    expect(free.id).toBe('free')
  })

  it('has a pro plan marked as highlighted', () => {
    const pro = getPlanById('pro')
    expect(pro).toBeDefined()
    expect(pro!.highlighted).toBe(true)
    expect(pro!.price).toBeGreaterThan(0)
  })

  it('has a team plan', () => {
    const team = getPlanById('team')
    expect(team).toBeDefined()
    expect(team!.price).toBeGreaterThan(0)
  })

  it('getPaidPlans excludes the free plan', () => {
    const paid = getPaidPlans()
    expect(paid).toHaveLength(2)
    expect(paid.every((p) => p.price > 0)).toBe(true)
  })

  it('returns undefined for unknown plan id', () => {
    expect(getPlanById('enterprise')).toBeUndefined()
  })

  it('every plan has at least 3 features', () => {
    for (const plan of PLANS) {
      expect(plan.features.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('every plan has a non-empty CTA', () => {
    for (const plan of PLANS) {
      expect(plan.cta.length).toBeGreaterThan(0)
    }
  })

  it('free plan has no stripePriceId', () => {
    const free = getFreePlan()
    expect(free.stripePriceId).toBeNull()
  })

  it('every plan has a unique id', () => {
    const ids = PLANS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only one plan is highlighted', () => {
    const highlighted = PLANS.filter((p) => p.highlighted)
    expect(highlighted).toHaveLength(1)
  })
})
