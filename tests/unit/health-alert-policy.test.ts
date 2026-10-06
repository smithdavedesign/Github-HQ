import { describe, it, expect } from 'vitest'
import { shouldAlertHealth, REALERT_DROP } from '../../src/lib/notifications/health-alert-policy'

const base = { threshold: 55, lastAlertedScore: null, retired: false }

describe('shouldAlertHealth', () => {
  it('alerts the first time a repo is below the threshold', () => {
    expect(shouldAlertHealth({ ...base, health: 48 })).toBe(true)
  })
  it('does not re-alert a repo sitting at the same low score (the weekly "dropped to 45" spam)', () => {
    expect(shouldAlertHealth({ ...base, health: 45, lastAlertedScore: 45 })).toBe(false)
    expect(shouldAlertHealth({ ...base, health: 42, lastAlertedScore: 45 })).toBe(false)
  })
  it(`re-alerts after a further drop of ${REALERT_DROP}+ points`, () => {
    expect(shouldAlertHealth({ ...base, health: 40, lastAlertedScore: 45 })).toBe(true)
  })
  it('never alerts for archived or sunsetting repos', () => {
    expect(shouldAlertHealth({ ...base, health: 20, retired: true })).toBe(false)
  })
  it('never alerts at or above the threshold, or without a score', () => {
    expect(shouldAlertHealth({ ...base, health: 55 })).toBe(false)
    expect(shouldAlertHealth({ ...base, health: null })).toBe(false)
  })
})
