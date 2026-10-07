import { describe, expect, it } from 'vitest'
import { commitCounts } from '@/lib/github/commit-stats'

const weeks = Array.from({ length: 52 }, (_, i) => ({ week: 1_700_000_000 + i * 604_800, total: i >= 48 ? 2 : i >= 39 ? 1 : 0, days: [] }))

describe('commit counts from GitHub\'s commit-activity stats', () => {
  it('counts the last week, 4 weeks and 13 weeks when GitHub has the stats', () => {
    const c = commitCounts(weeks, null)
    expect(c).toMatchObject({ weeklyCommits: 2, monthlyCommits: 8, quarterlyCommits: 17, fresh: true })
    expect(c.weeklyCommitData).toHaveLength(13)
  })

  it('keeps the previous counts while GitHub is still computing (202, empty body), not zeros', () => {
    const previous = { weeklyCommits: 1, monthlyCommits: 3, quarterlyCommits: 9, weeklyCommitData: [{ week: 1, total: 1 }] }
    expect(commitCounts({}, previous)).toEqual({ ...previous, fresh: false })
    expect(commitCounts(null, previous)).toEqual({ ...previous, fresh: false })
  })

  it('a first sync without stats has nothing to keep: zeros', () => {
    expect(commitCounts({}, null)).toEqual({ weeklyCommits: 0, monthlyCommits: 0, quarterlyCommits: 0, weeklyCommitData: [], fresh: false })
  })
})
