import { describe, it, expect } from 'vitest'
import { hasAdvisorShape } from '../../src/lib/ai/advisor-shape'

describe('hasAdvisorShape', () => {
  it('accepts a headline with an actions array', () => {
    expect(hasAdvisorShape({ headline: 'Ship it', actions: [], generatedAt: '2026-10-19T00:00:00Z' })).toBe(true)
  })

  it('rejects the row that crashed the dashboard on 2026-10-19', () => {
    expect(hasAdvisorShape({ generatedAt: '2026-10-19T06:41:52.045Z' })).toBe(false)
  })

  it('rejects null, non-objects and a non-array actions', () => {
    expect(hasAdvisorShape(null)).toBe(false)
    expect(hasAdvisorShape('text')).toBe(false)
    expect(hasAdvisorShape({ headline: 'x', actions: {} })).toBe(false)
  })
})
