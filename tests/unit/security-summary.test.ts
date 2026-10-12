import { describe, it, expect } from 'vitest'
import { summarizeFindings, quietReason, type FindingGroup } from '@/lib/security/summary'

const g = (o: Partial<FindingGroup>): FindingGroup => ({
  repoId: 1, repoName: 'app', fullName: 'o/app', isArchived: false, lifecycleStatus: 'production', activityStatus: 'Actively Maintained',
  packageName: 'lodash', type: 'dependabot', severity: 'high', count: 1, newest: new Date('2026-10-01'), title: 'Prototype pollution', ...o,
})

describe('Security page summary', () => {
  it('totals every alert and groups a repo\'s alerts by package, worst package first', () => {
    const s = summarizeFindings([
      g({ packageName: 'lodash', severity: 'high', count: 3 }),
      g({ packageName: 'lodash', severity: 'critical', count: 1, title: 'RCE in lodash' }),
      g({ packageName: 'qs', severity: 'medium', count: 2, newest: new Date('2026-10-05') }),
      g({ packageName: null, type: 'secret', severity: 'critical', count: 1, title: 'Stripe key' }),
    ])
    expect(s.totals).toEqual({ critical: 2, high: 3, medium: 2, low: 0 })
    const [app] = s.active
    expect(app.counts).toEqual({ critical: 2, high: 3, medium: 2, low: 0 })
    expect(app.total).toBe(7)
    expect(app.newest).toEqual(new Date('2026-10-05'))
    expect(app.packages).toEqual([
      { name: 'lodash', severity: 'critical', count: 4, title: 'RCE in lodash' },
      { name: 'Stripe key', severity: 'critical', count: 1, title: 'Stripe key' },
      { name: 'qs', severity: 'medium', count: 2, title: 'Prototype pollution' },
    ])
  })

  it('keeps archived, sunsetting and dormant repos apart, each list worst first', () => {
    const s = summarizeFindings([
      g({ repoId: 1, repoName: 'live-a', severity: 'high', count: 5 }),
      g({ repoId: 2, repoName: 'live-b', severity: 'critical', count: 1 }),
      g({ repoId: 3, repoName: 'old', activityStatus: 'Dormant', severity: 'critical', count: 160 }),
      g({ repoId: 4, repoName: 'gone', isArchived: true, severity: 'low', count: 2 }),
    ])
    expect(s.active.map(r => r.repoName)).toEqual(['live-b', 'live-a'])
    expect(s.quiet.map(r => [r.repoName, r.quietReason])).toEqual([['old', 'dormant'], ['gone', 'archived on GitHub']])
  })

  it('caps the packages shown and says how many more there are', () => {
    const groups = Array.from({ length: 9 }, (_, i) => g({ packageName: `p${i}`, count: 9 - i }))
    const [r] = summarizeFindings(groups, 6).active
    expect(r.packages.map(p => p.name)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
    expect(r.morePackages).toBe(3)
  })

  it('names why a repo is quiet', () => {
    expect(quietReason({ isArchived: false, lifecycleStatus: 'sunsetting', activityStatus: 'Actively Maintained' })).toBe('sunsetting')
    expect(quietReason({ isArchived: false, lifecycleStatus: 'maintaining', activityStatus: 'Abandoned' })).toBe('abandoned')
    expect(quietReason({ isArchived: false, lifecycleStatus: 'production', activityStatus: 'Low Activity' })).toBeNull()
  })
})
