import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TODAY_MAX, growthLines, kitChannels, nextPost, readGrowthInput, todayLines, type GrowthInput } from '../../factory/context/growth'
import type { IdeaState } from '../../factory/context/ideas'
import type { OpenPr } from '../../src/lib/agents/open-prs'

const NOW = new Date('2026-10-13T13:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
const KIT = '# Launch kit: tiebreak\n\n## Order\n1. **r/SideProject**, Tue, 8–11am ET. Builders.\n2. **r/EtsySellers**, from Wed. Buyers.\n3. Indie Hackers: Show IH, Thu.\n\nSpace them.\n\n## r/SideProject\n…'
const payments = { id: 'payments', label: 'Stripe product created and mapped to the repo in RepoHQ', owner: 'david' as const }
const tiebreak: IdeaState = {
  slug: 'tiebreak', title: 'tiebreak — swipe-to-decide polls', stage: 'building', repo: 'https://github.com/o/tiebreak',
  launch: { steps: [], next: payments, done: 6, total: 10, price: '$5 once' },
  funnel: { d7: { visit: 3, activate: 0, checkout: 0 }, prev7: { visit: 0 }, all: { visit: 3 }, seen: { visit: false }, referrers7d: [{ host: 'google.com', visitors: 2 }] },
}
const permitly: IdeaState = { slug: 'permitly', title: 'permitly — permit tracker', stage: 'validate' }
const growth = (over: Partial<GrowthInput> = {}): GrowthInput => ({ focus: ['tiebreak'], minVisitorsPerWeek: 50, holdNewBuilds: true, kits: { tiebreak: KIT }, logs: {}, ...over })
const pr = (over: Partial<OpenPr>): OpenPr => ({ repo: 'o/tiebreak', number: 4, title: 'Growth: SEO pages', url: 'https://github.com/o/tiebreak/pull/4', author: 'me', createdAt: new Date(hoursAgo(5)), isDraft: true, labels: [], ...over })

describe('launch kits', () => {
  it("reads a kit's channels in posting order: the bold name, else the text before the first comma or colon", () => {
    expect(kitChannels(KIT)).toEqual(['r/SideProject', 'r/EtsySellers', 'Indie Hackers'])
    expect(kitChannels(undefined)).toEqual([])
    expect(kitChannels('# kit\n## Dropped\n- x')).toEqual([])
  })
  it('the next post is the first channel without a logged post, a day after the last one', () => {
    expect(nextPost(KIT, undefined, NOW)).toEqual({ channel: 'r/SideProject', index: 1, total: 3 })
    const posted = { posts: [{ channel: 'r/sideproject', postedAt: hoursAgo(30) }] }
    expect(nextPost(KIT, posted, NOW)).toEqual({ channel: 'r/EtsySellers', index: 2, total: 3 })
    expect(nextPost(KIT, { posts: [{ channel: 'r/SideProject', postedAt: hoursAgo(3) }] }, NOW), 'spaced a day apart').toBeNull()
    const all = { posts: ['r/SideProject', 'EtsySellers', 'indiehackers.com'].map(channel => ({ channel, postedAt: hoursAgo(48) })) }
    expect(nextPost(KIT, all, NOW), 'every channel posted').toBeNull()
  })
})

describe('Today', () => {
  it("money first: the focus product's checklist step, its next post, a demand test's missing kit, then idea PRs", () => {
    const lines = todayLines([tiebreak, permitly], growth(), [pr({}), pr({ repo: 'o/other', number: 9 })], NOW)
    expect(lines).toEqual([
      'tiebreak, your step on the road to revenue: Stripe product created and mapped to the repo in RepoHQ (https://davids-macbook-pro.tail39508b.ts.net/ideas/tiebreak)',
      'Post tiebreak to r/SideProject (1 of 3 in its launch kit, written and ready), then log it with /launch tiebreak posted',
      'permitly has no launch kit yet: run /launch permitly for posts ready to paste',
      'Merge or close tiebreak#4 (Growth: SEO pages): https://github.com/o/tiebreak/pull/4',
    ])
  })
  it("with autonomy on, lists only the pipeline's PRs it left for you, with why", () => {
    const building = (prUrl: string, held?: string): IdeaState => ({ ...tiebreak, launch: undefined, build: { milestone: 'GROWTH', status: 'pr-open', prUrl, ...(held ? { held } : {}) } })
    const prs = [pr({}), pr({ number: 5, title: 'Bump next', url: 'https://github.com/o/tiebreak/pull/5' })]
    expect(todayLines([building('https://github.com/o/tiebreak/pull/4')], growth({ kits: {}, autonomy: true }), prs, NOW).filter(l => l.startsWith('Merge')))
      .toEqual(['Merge or close tiebreak#5 (Bump next): https://github.com/o/tiebreak/pull/5'])
    expect(todayLines([building('https://github.com/o/tiebreak/pull/4', 'web failed')], growth({ kits: {}, autonomy: true }), prs, NOW).filter(l => l.startsWith('Merge'))[0])
      .toBe('Merge or close tiebreak#4 (Growth: SEO pages), left for you: web failed: https://github.com/o/tiebreak/pull/4')
    expect(todayLines([building('https://github.com/o/tiebreak/pull/4')], growth({ kits: {} }), prs, NOW).filter(l => l.startsWith('Merge'))).toHaveLength(2)
  })
  it('puts the demand test closest to its decision first', () => {
    const later = { ...permitly, slug: 'packpass', title: 'packpass — x', validation: { startedAt: '2026-10-12', decideAfter: '2026-10-26T00:00:00Z' } }
    const sooner = { ...permitly, validation: { startedAt: '2026-10-10', decideAfter: '2026-10-24T00:00:00Z' } }
    const lines = todayLines([later, sooner], growth({ focus: [] }), [], NOW)
    expect(lines.map(l => l.split(' ')[0])).toEqual(['permitly', 'packpass'])
  })
  it(`stops at ${TODAY_MAX} lines and says how many more`, () => {
    const validating = Array.from({ length: 6 }, (_, k): IdeaState => ({ slug: `v${k}`, title: `v${k}`, stage: 'validate' }))
    const lines = todayLines([tiebreak, ...validating], growth(), [], NOW)
    expect(lines).toHaveLength(TODAY_MAX + 1)
    expect(lines.at(-1)).toBe('…and 3 more: https://davids-macbook-pro.tail39508b.ts.net/ideas')
  })
  it('says when there is nothing to do', () => {
    const done = { ...tiebreak, launch: { ...tiebreak.launch!, next: { id: 'firstUser', label: 'First user or signup', owner: 'david' as const } } }
    const posted = { tiebreak: { posts: [{ channel: 'r/SideProject', postedAt: hoursAgo(2) }] } }
    expect(todayLines([done], growth({ logs: posted }), null, NOW)).toEqual(['Nothing for you in the growth loop today.'])
  })
})

describe('Growth section', () => {
  it('names the focus and the hold, then each product: funnel and sources, the old beacon, distribution, road to revenue', () => {
    const lines = growthLines([tiebreak], growth({ logs: { tiebreak: { posts: [{ channel: 'r/SideProject', postedAt: '2026-10-13T09:00:00Z' }] } } }))
    expect(lines).toEqual([
      'Focus: tiebreak. Traction bar: 50 visitors a week. Until one reaches it, ideas never built wait for their first build.',
      'tiebreak: 3 visitors this week (0 the week before), 0 activations, 0 Buy clicks; sources: google.com 2.',
      "tiebreak still runs the old beacon (one view from the home page), so activations and Buy clicks aren't counted yet; its next growth build adds them.",
      'Distribution: 1 of 3 kit channels posted, the last on 2026-10-13.',
      'Road to revenue: 6/10, next: Stripe product created and mapped to the repo in RepoHQ (yours).',
    ])
    const busy = { ...tiebreak, funnel: { ...tiebreak.funnel!, d7: { visit: 60 }, seen: { visit: true } } }
    expect(growthLines([busy], growth())[0]).toMatch(/Reached, so new MVP builds can start again\.$/)
    expect(growthLines([permitly], growth({ focus: [] }))).toEqual([])
    const swept = { ...tiebreak, funnel: { ...tiebreak.funnel!, d7: { visit: 9, activate: 0, checkout: 0 }, burst7d: 24 } }
    expect(growthLines([swept], growth())[1], 'visitors left out as a burst are said, not hidden')
      .toMatch(/^tiebreak: 9 visitors this week \(0 the week before\), 0 activations, 0 Buy clicks \(24 more left out: a burst of direct visits that did nothing, likely crawlers or a test\); sources:/)
  })
  it("reads the focus, the bar, kits and logs from idea-factory's files", () => {
    const home = mkdtempSync(path.join(tmpdir(), 'growth-'))
    writeFileSync(path.join(home, 'policy.json'), JSON.stringify({ build: { startNew: false }, growth: { focus: ['tiebreak'], minVisitorsPerWeek: 40 }, autonomy: { merge: true } }))
    mkdirSync(path.join(home, 'ideas', 'tiebreak'), { recursive: true })
    writeFileSync(path.join(home, 'ideas', 'tiebreak', 'LAUNCH-KIT.md'), KIT)
    writeFileSync(path.join(home, 'ideas', 'tiebreak', 'launch-log.json'), JSON.stringify({ posts: [{ channel: 'r/SideProject', postedAt: '2026-10-13T09:00:00Z' }] }))
    const g = readGrowthInput(home, [tiebreak, permitly])
    expect(g).toMatchObject({ focus: ['tiebreak'], minVisitorsPerWeek: 40, holdNewBuilds: true, autonomy: true, kits: { tiebreak: KIT } })
    expect(g.logs.tiebreak!.posts).toHaveLength(1)
    expect(readGrowthInput(path.join(home, 'nope'), [])).toEqual({ focus: [], minVisitorsPerWeek: 50, holdNewBuilds: false, autonomy: false, kits: {}, logs: {} })
  })
})

describe('Growth loop lines', () => {
  it("shows the loop's stage, next mission and live experiments for a focus product", () => {
    const withGrowth: IdeaState = { ...tiebreak, growth: { stage: 'instrument', bottleneck: 'its beacon only counts home-page views', next: null,
      experiments: [{ id: 'tiebreak-20261013-instrumentation', kind: 'instrumentation', executor: 'build', hypothesis: 'h', metric: 'beacon', baseline: 0, target: 1, windowDays: 7,
        status: 'proposed', createdAt: '2026-10-13T10:00:00Z', prUrl: 'https://github.com/o/tiebreak/pull/9' }] } }
    const lines = growthLines([withGrowth], growth())
    expect(lines).toContain('Growth loop: measuring the funnel (its beacon only counts home-page views). Next: waiting for the last mission’s result.')
    expect(lines).toContain('Experiment: funnel beacon · PR open · old beacon → beacon live — https://github.com/o/tiebreak/pull/9')
  })
  it('asks whether to park a product whose experiments moved nothing', () => {
    const parked: IdeaState = { ...tiebreak, launch: undefined, growth: { stage: 'park', bottleneck: 'the last 2 experiments moved nothing', next: { kind: 'park', executor: 'owner' } } }
    expect(todayLines([parked], growth({ kits: {} }), [], NOW)[0]).toBe('tiebreak: the last 2 experiments moved nothing. Park it or keep going? (https://davids-macbook-pro.tail39508b.ts.net/ideas/tiebreak)')
  })
})

describe('Growth section and the funnel beacon', () => {
  it("doesn't call a fresh funnel beacon the old one just because no visit came yet", () => {
    const fresh: IdeaState = { ...tiebreak, golive: { mergedAt: '2026-10-13T00:00:00Z', beacon: 'funnel' } }
    expect(growthLines([fresh], growth()).some(l => /old beacon/.test(l))).toBe(false)
    expect(growthLines([tiebreak], growth()).some(l => /old beacon/.test(l))).toBe(true)
  })
})

describe('the feature loop (weekly plans, features built at night)', () => {
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
  const item = (id: string, over = {}) => ({ id, title: id.replace('-', ' '), metric: 'visit' as const, acceptance: ['a', 'b'], ...over })
  const feature = (id: string, over = {}) => ({ id, kind: 'feature', executor: 'build' as const, hypothesis: 'h', metric: 'visit' as const, baseline: 4, target: 50, windowDays: 14, status: 'proposed' as const, createdAt: ago(1), ...over })
  const withPlan: IdeaState = {
    ...tiebreak,
    growth: {
      stage: 'acquire', bottleneck: '4 visitors this week, under 50', next: { kind: 'seo', executor: 'build' },
      plan: { at: ago(2), items: [item('compare-pages', { attempts: ['e1'] }), item('first-run', { payments: true }), item('old-idea', { attempts: ['e2'] })] },
      experiments: [
        feature('e1', { status: 'running', prUrl: 'https://github.com/o/tiebreak/pull/7', startedAt: ago(1), title: 'Comparison pages' }),
        feature('e2', { status: 'decided', decision: 'keep', decidedAt: ago(1), createdAt: ago(20), startedAt: ago(15), title: 'Old idea', result: { value: 60, before: 4 } }),
      ],
    },
  }

  it("a plan item's status follows its builds", async () => {
    const { planItemStatus } = await import('../../src/lib/ideas/idea-utils')
    const exps = withPlan.growth!.experiments!
    expect(planItemStatus(item('x'), exps)).toBe('planned')
    expect(planItemStatus(item('x', { attempts: ['e1'] }), exps)).toBe('shipped')
    expect(planItemStatus(item('x', { attempts: ['e2'] }), exps)).toBe('decided')
    const failed = [1, 2, 3].map(n => feature(`f${n}`, { status: 'abandoned', failed: true }))
    expect(planItemStatus(item('x', { attempts: ['f1'] }), failed)).toBe('failed')
    expect(planItemStatus(item('x', { attempts: ['f1', 'f2', 'f3'] }), failed)).toBe('dropped')
  })

  it('the email shows each focus product\'s plan and what the week built and moved', () => {
    const lines = growthLines([withPlan], growth())
    expect(lines[1]).toBe('Features, last 7 days: 1 built, 1 merged; judged: tiebreak: Old idea keep (4 visitors a week → 60 visitors a week). They build at night (22:00–07:00), one per product at a time.')
    expect(lines).toContain(`Plan, week of ${withPlan.growth!.plan!.at.slice(0, 10)}: 1. compare pages (shipped); 2. first run (planned, payments: yours to merge); 3. old idea (decided).`)
    expect(growthLines([tiebreak], growth()).some(l => l.startsWith('Features, last 7 days')), 'no plan, no feature line').toBe(false)
  })
})
