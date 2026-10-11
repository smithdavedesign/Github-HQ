import { describe, it, expect } from 'vitest'
import {
  buildSlot, checkDecision, decisionLabel, demandProgress, groupIdeas, needsDecision, pipelineHealth, reviewQueue, safeUrl, shortTitle, tagline,
  whatHappens, type IdeaDecisionRow, type IdeaView,
} from '../../src/lib/ideas/idea-utils'

const NOW = new Date('2026-10-11T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function idea(slug: string, over: Partial<IdeaView> = {}): IdeaView {
  return {
    slug, title: `${slug} — a tool for someone`, stage: 'idea', idea: { oneLiner: 'one liner' }, state: {}, review: null, docs: {},
    notionUrl: `https://www.notion.so/${slug}`, updatedAt: null, signals: null, decisions: [], ...over,
  }
}
const decision = (over: Partial<IdeaDecisionRow>): IdeaDecisionRow => ({
  id: 1, slug: 'x', decision: 'build', note: null, status: 'pending', result: null, createdAt: NOW, appliedAt: null, ...over,
})
const POLICY = {
  review: { minScore: 6 }, build: { maxPerWeek: 1 },
  validation: { days: 14, maxValidating: 5, minVisitorsToJudge: 50, build: { minSignups: 5, minSignupRate: 0.05 }, buildEarly: { minSignups: 10, minSignupRate: 0.08 } },
}

describe('Ideas page: who needs a call', () => {
  it('unreviewed ideas and recent pipeline-only verdicts need the owner; decided or old ones do not', () => {
    expect(needsDecision(idea('a'), NOW)).toBe(true)
    const recentPass = idea('b', { stage: 'pass', state: { review: { verdict: 'pass', score: 3, at: daysAgo(1) } } })
    expect(needsDecision(recentPass, NOW)).toBe(true)
    expect(needsDecision({ ...recentPass, state: { ...recentPass.state, review: { verdict: 'pass', score: 3, at: daysAgo(30) } } }, NOW)).toBe(false)
    expect(needsDecision({ ...recentPass, state: { ...recentPass.state, passReason: 'owner' } }, NOW)).toBe(false)
    expect(needsDecision({ ...recentPass, decisions: [decision({ status: 'pending' })] }, NOW)).toBe(false)
    expect(needsDecision({ ...recentPass, state: { ...recentPass.state, ownerDecision: { decision: 'pass', at: daysAgo(0) } } }, NOW)).toBe(false)
    expect(needsDecision(idea('c', { stage: 'building' }), NOW)).toBe(false)
  })
  it('groups by stage and sorts by review score, then newest; the review queue is the "needs your call" list', () => {
    const views = [
      idea('low', { state: { review: { verdict: 'validate', score: 4, at: daysAgo(1) } }, stage: 'validate' }),
      idea('high', { state: { review: { verdict: 'pass', score: 7, at: daysAgo(2) } }, stage: 'pass' }),
      idea('built', { stage: 'building' }),
      idea('old-pass', { stage: 'pass', state: { review: { verdict: 'pass', score: 2, at: daysAgo(40) } } }),
      idea('live', { stage: 'live', state: { revenue: { mrr: 5 } } }),
    ]
    const g = groupIdeas(views, NOW)
    expect(g.decide.map(v => v.slug)).toEqual(['high'])
    expect(g.testing.map(v => v.slug)).toEqual(['low'])
    expect(g.building.map(v => v.slug)).toEqual(['built'])
    expect(g.passed.map(v => v.slug)).toEqual(['old-pass'])
    expect(g.live.map(v => v.slug)).toEqual(['live'])
    expect(reviewQueue(views, NOW)).toEqual(['high'])
  })
})

describe('Ideas page: what each decision may do', () => {
  const landing = { landing: { headline: 'h' } }
  it('follows the pipeline: build from idea/validate/pass (or an unapproved repo), test needs landing copy, pass before any build', () => {
    expect(checkDecision(idea('a', { stage: 'pass' }), 'build').ok).toBe(true)
    expect(checkDecision(idea('a', { stage: 'repo', state: {} }), 'build').ok).toBe(true)
    expect(checkDecision(idea('a', { stage: 'repo', state: { ownerApproved: true } }), 'build').ok).toBe(false)
    expect(checkDecision(idea('a', { stage: 'building' }), 'build').ok).toBe(false)
    expect(checkDecision(idea('a', { stage: 'pass', review: landing }), 'validate').ok).toBe(true)
    expect(checkDecision(idea('a', { stage: 'pass', review: {} }), 'validate')).toMatchObject({ ok: false, reason: expect.stringMatching(/landing-page copy/) })
    expect(checkDecision(idea('a', { stage: 'validate', review: landing }), 'validate').ok).toBe(false)
    expect(checkDecision(idea('a', { stage: 'validate' }), 'pass').ok).toBe(true)
    expect(checkDecision(idea('a', { stage: 'live' }), 'pass').ok).toBe(false)
    // Agreeing with the review's pass, once.
    expect(checkDecision(idea('a', { stage: 'pass' }), 'pass').ok).toBe(true)
    expect(checkDecision(idea('a', { stage: 'pass', state: { passReason: 'owner' } }), 'pass').ok).toBe(false)
    expect(checkDecision(idea('a', { notionUrl: null }), 'build')).toMatchObject({ ok: false, reason: expect.stringMatching(/no Notion row/) })
  })
  it('explains what happens next, including a used build slot', () => {
    const free = buildSlot([], POLICY, NOW)
    expect(free).toEqual({ used: 0, max: 1, free: true, nextFreeAt: null })
    const usedAt = daysAgo(2)
    const used = buildSlot([idea('x', { state: { build: { at: usedAt } } }), idea('y', { state: { build: { at: daysAgo(9) } } })], POLICY, NOW)
    expect(used).toMatchObject({ used: 1, free: false })
    expect(used.nextFreeAt!.toISOString()).toBe(new Date(new Date(usedAt).getTime() + 7 * 86_400_000).toISOString())
    expect(whatHappens('build', idea('permitly'), free, POLICY, 0).join(' ')).toMatch(/Creates the private repo permitly.*Builds M1 right after/)
    expect(whatHappens('build', idea('permitly'), used, POLICY, 0).join(' ')).toMatch(/build slot is used \(1 of 1\); M1 starts after/)
    expect(whatHappens('validate', idea('p'), free, POLICY, 5).join(' ')).toMatch(/5 demand tests are already running/)
    expect(whatHappens('pass', idea('p', { stage: 'validate' }), free, POLICY, 0).join(' ')).toMatch(/demand test stops/)
    expect(whatHappens('pass', idea('p', { stage: 'pass' }), free, POLICY, 0).join(' ')).toMatch(/agree with the review/)
  })
})

describe('Ideas page: demand tests and pipeline health', () => {
  const validation = { startedAt: daysAgo(1), decideAfter: new Date(NOW.getTime() + 13 * 86_400_000).toISOString() }
  it('says traffic is the bottleneck below the visitor bar, and reads live signals over the synced ones', () => {
    const d = demandProgress({ views: 2, uniqueVisitors: 1, signups: 0 }, { validation, signals: { views: 0, uniqueVisitors: 0, signups: 0 } }, POLICY, NOW)
    expect(d).toMatchObject({ visitors: 1, signups: 0, minVisitors: 50, daysLeft: 13 })
    expect(d.status).toMatch(/1 of the 50 visitors.*launch post/)
    expect(demandProgress({ views: 200, uniqueVisitors: 100, signups: 12 }, { validation }, POLICY, NOW).status).toMatch(/Strong early signal/)
    expect(demandProgress({ views: 200, uniqueVisitors: 100, signups: 6 }, { validation }, POLICY, NOW).status).toMatch(/On track/)
    expect(demandProgress({ views: 200, uniqueVisitors: 100, signups: 2 }, { validation }, POLICY, NOW).status).toMatch(/Below the bar/)
  })
  it('flags a pipeline that has not ticked for an hour', () => {
    expect(pipelineHealth(new Date(NOW.getTime() - 5 * 60_000), true, NOW)).toMatchObject({ stale: false, label: expect.stringMatching(/5 min ago/) })
    expect(pipelineHealth(new Date(NOW.getTime() - 3 * 3600_000), true, NOW)).toMatchObject({ stale: true, label: expect.stringMatching(/3 h ago/) })
    expect(pipelineHealth(null, null, NOW).stale).toBe(true)
  })
})

describe('Ideas page: text and links', () => {
  it('splits the title and only keeps http(s) links', () => {
    expect(shortTitle('permitly — permit tracker')).toBe('permitly')
    expect(tagline(idea('x', { title: 'x — the pitch' }))).toBe('the pitch')
    expect(tagline(idea('x', { title: 'x' }))).toBe('one liner')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('https://a.example/b')).toBe('https://a.example/b')
    expect(safeUrl('not a url')).toBeNull()
    expect(decisionLabel('pass', 'pass')).toBe('Agree, keep passed')
    expect(decisionLabel('pass', 'validate')).toBe('Pass')
  })
})
