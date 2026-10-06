import { describe, it, expect } from 'vitest'
import { planPrune, MAX_PRUNE_SHARE } from '../../src/lib/github/prune'

const tracked = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, githubId: 1000 + i }))
const listed = (ids: number[]) => new Set(ids)

describe('planPrune', () => {
  it('prunes repos missing from the GitHub listing (deleted or transferred)', () => {
    const repos = tracked(66)
    const all = repos.map(r => r.githubId)
    // the audit's two ghosts: deleted on GitHub, still tracked
    const plan = planPrune(repos, listed(all.filter(g => g !== 1002 && g !== 1017)))
    expect(plan).toEqual({ ids: [3, 18], skipped: null })
  })

  it('prunes nothing when every tracked repo is still listed (renames keep their GitHub id)', () => {
    const repos = tracked(10)
    expect(planPrune(repos, listed(repos.map(r => r.githubId)))).toEqual({ ids: [], skipped: null })
  })

  it('ignores repos that are new on GitHub (sync inserts those)', () => {
    const repos = tracked(3)
    expect(planPrune(repos, listed([...repos.map(r => r.githubId), 9999])).ids).toEqual([])
  })

  it('refuses to prune on an empty listing (token or API problem, not a deleted portfolio)', () => {
    const plan = planPrune(tracked(66), listed([]))
    expect(plan.ids).toEqual([])
    expect(plan.skipped).toMatch(/no repos/)
  })

  it('an empty listing with nothing tracked is not a warning', () => {
    expect(planPrune([], listed([]))).toEqual({ ids: [], skipped: null })
  })

  it(`refuses a mass prune above ${MAX_PRUNE_SHARE * 100}% of tracked repos`, () => {
    const repos = tracked(66)
    // 14 missing > floor(66 × 0.2) = 13
    const plan = planPrune(repos, listed(repos.slice(14).map(r => r.githubId)))
    expect(plan.ids).toEqual([])
    expect(plan.skipped).toMatch(/14 of 66 .*limit 13/)
  })

  it('allows exactly the limit', () => {
    const repos = tracked(66)
    expect(planPrune(repos, listed(repos.slice(13).map(r => r.githubId))).ids).toHaveLength(13)
  })

  it('small portfolios can still prune up to 3 at once', () => {
    const repos = tracked(5)
    expect(planPrune(repos, listed([repos[0].githubId, repos[1].githubId])).ids).toEqual([3, 4, 5])
    expect(planPrune(tracked(5), listed([1000])).skipped).toMatch(/4 of 5/)
  })
})
