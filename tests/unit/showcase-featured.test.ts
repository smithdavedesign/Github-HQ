import { describe, it, expect } from 'vitest'
import { isFeaturedPublicRepo } from '../../src/lib/health/showcase'

const repo = { isArchived: false, lifecycleStatus: 'maintaining', healthScore: 60, hasLiveDeployment: false, isFocused: false }

describe('isFeaturedPublicRepo', () => {
  it('features healthy active repos', () => {
    expect(isFeaturedPublicRepo(repo)).toBe(true)
  })
  it('hides archived, sunsetting and lifecycle-archived repos whatever their score', () => {
    expect(isFeaturedPublicRepo({ ...repo, isArchived: true })).toBe(false)
    expect(isFeaturedPublicRepo({ ...repo, lifecycleStatus: 'archived', healthScore: 90 })).toBe(false)
    expect(isFeaturedPublicRepo({ ...repo, lifecycleStatus: 'sunsetting' })).toBe(false)
  })
  it('hides low-health repos unless live or focused', () => {
    expect(isFeaturedPublicRepo({ ...repo, healthScore: 45 })).toBe(false)
    expect(isFeaturedPublicRepo({ ...repo, healthScore: 45, hasLiveDeployment: true })).toBe(true)
    expect(isFeaturedPublicRepo({ ...repo, healthScore: 45, isFocused: true })).toBe(true)
    expect(isFeaturedPublicRepo({ ...repo, healthScore: null })).toBe(false)
  })
})
