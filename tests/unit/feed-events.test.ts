import { describe, it, expect } from 'vitest'
import { newAlertsEntry, newestFirst } from '@/lib/feed/events'

const now = new Date('2026-10-12T12:00:00Z')
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000)

describe('Portfolio Feed: events, not standing alerts', () => {
  it('shows alerts raised in the last two weeks, once per repo, dated by the newest', () => {
    const e = newAlertsEntry([
      { severity: 'high', title: 'old high', createdAt: ago(400) },
      { severity: 'high', title: 'proxy-addr spoofing', createdAt: ago(3) },
      { severity: 'critical', title: 'RCE in next', createdAt: ago(1) },
      { severity: 'medium', title: 'medium is the Security page\'s', createdAt: ago(0) },
    ], now)
    expect(e).toEqual({ type: 'security_critical', description: '2 new critical or high alerts', detail: 'RCE in next', severity: 'critical', date: ago(1) })
  })

  it('a repo whose alerts are all old (a 7-year-old Dependabot backlog) gets no entry', () => {
    expect(newAlertsEntry([{ severity: 'critical', title: 'x', createdAt: ago(2555) }, { severity: 'high', title: 'y', createdAt: null }], now)).toBeNull()
  })

  it('orders newest first: a critical entry no longer outranks this week\'s merge', () => {
    const order = newestFirst([
      { id: 'alert', severity: 'critical', date: ago(30) },
      { id: 'merge', severity: 'positive', date: ago(0) },
      { id: 'dormant', severity: 'info', date: ago(200) },
    ]).map(e => e.id)
    expect(order).toEqual(['merge', 'alert', 'dormant'])
  })
})
