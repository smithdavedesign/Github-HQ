import { describe, it, expect } from 'vitest'
import { launchKitOrder,
  buildSlot, checkDecision, cleanIdeaText, decisionLabel, seedStatusLabel, demandProgress, groupIdeas, needsDecision, pipelineHealth, reviewQueue, safeUrl, shortTitle, tagline,
  whatHappens, buildNowTarget, buildNowSteps, buildRequestLabel, roadmapMilestones, buildMvpTarget, buildMvpSteps, milestoneRange, goLiveTarget, goLiveSteps,
  experimentLine, buildAutonomyNote, nextMissionText, growthKindLabel, GROWTH_STAGE_LABEL, beaconLive, type GrowthExperiment,
  type IdeaBuildRequestRow, type IdeaDecisionRow, type IdeaView,
} from '../../src/lib/ideas/idea-utils'

const NOW = new Date('2026-10-11T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function idea(slug: string, over: Partial<IdeaView> = {}): IdeaView {
  return {
    slug, title: `${slug} — a tool for someone`, stage: 'idea', idea: { oneLiner: 'one liner' }, state: {}, review: null, docs: {},
    updatedAt: null, signals: null, decisions: [], buildRequests: [], ...over,
  }
}
const decision = (over: Partial<IdeaDecisionRow>): IdeaDecisionRow => ({
  id: 1, slug: 'x', decision: 'build', note: null, status: 'pending', result: null, createdAt: NOW, appliedAt: null, ...over,
})
const POLICY = {
  review: { minScore: 6 }, build: { concurrency: { max: 3, reserveForRequests: 1 } },
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
    // No Notion since 2026-10-12: a just-recorded idea can be decided right away.
    expect(checkDecision(idea('a'), 'build')).toEqual({ ok: true })
  })
  it('explains what happens next, including when every build slot is taken', () => {
    const free = buildSlot([], POLICY)
    expect(free).toEqual({ running: 0, max: 3, free: true, autoFree: true, held: null })
    const building = (slug: string) => idea(slug, { state: { build: { status: 'running' } } })
    const claimed = idea('z', { buildRequests: [{ id: 1, slug: 'z', milestone: 'MVP', note: null, status: 'running', result: null, prUrl: null, engine: null, createdAt: NOW, startedAt: NOW, finishedAt: null }] })
    const busy = buildSlot([building('x'), building('y'), claimed], POLICY)
    expect(busy).toMatchObject({ running: 3, free: false, autoFree: false })
    expect(buildSlot([building('x'), building('y')], POLICY), 'the last slot is kept for Start build now').toMatchObject({ running: 2, free: true, autoFree: false })
    expect(whatHappens('build', idea('permitly'), free, POLICY, 0).join(' ')).toMatch(/Creates the private repo permitly.*Builds M1 right after/)
    expect(whatHappens('build', idea('permitly'), busy, POLICY, 0).join(' ')).toMatch(/3 builds are running \(up to 3 at once, the last slot kept for Start build now\): its first build starts when one finishes\./)
    expect(whatHappens('validate', idea('p'), free, POLICY, 5).join(' ')).toMatch(/5 demand tests are already running/)
    expect(whatHappens('pass', idea('p', { stage: 'validate' }), free, POLICY, 0).join(' ')).toMatch(/demand test stops/)
    expect(whatHappens('pass', idea('p', { stage: 'pass' }), free, POLICY, 0).join(' ')).toMatch(/agree with the review/)
  })
  it('holds first builds until a focus product has traction (policy.build.startNew false)', () => {
    const policy = { ...POLICY, build: { startNew: false }, growth: { focus: ['tiebreak'], minVisitorsPerWeek: 50 } }
    const quiet = idea('tiebreak', { stage: 'live', state: { funnel: { d7: { visit: 3 } } } })
    const slot = buildSlot([quiet], policy)
    expect(slot.held).toBe('new builds wait until tiebreak has 50 visitors a week')
    expect(whatHappens('build', idea('permitly'), slot, policy, 0).join(' ')).toMatch(/Its first build waits: new builds wait until tiebreak has 50 visitors a week\. Start build now builds it sooner/)
    expect(buildSlot([idea('tiebreak', { state: { funnel: { d7: { visit: 50 } } } })], policy).held).toBeNull()
    expect(buildSlot([quiet], POLICY).held, 'no startNew setting: nothing held').toBeNull()
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

describe('Ideas page: new ideas', () => {
  it('cleans submitted text like idea-publish.js seed', () => {
    expect(cleanIdeaText('idea: warn co-hosts about rule changes')).toEqual({ ok: true, text: 'warn co-hosts about rule changes' })
    expect(cleanIdeaText('  short ')).toMatchObject({ ok: false, reason: expect.stringMatching(/at least 8/) })
    expect((cleanIdeaText('x'.repeat(3000)) as { text: string }).text).toHaveLength(2000)
  })
  it('says where a submitted idea stands', () => {
    expect(seedStatusLabel({ status: 'pending', result: null }, 0)).toMatch(/within 15 min/)
    expect(seedStatusLabel({ status: 'queued', result: null }, 0)).toMatch(/Next in the research queue: researched and reviewed within about half an hour/)
    expect(seedStatusLabel({ status: 'queued', result: null }, 2)).toMatch(/2 ahead of it: up to 10 are researched a day/)
    expect(seedStatusLabel({ status: 'queued', result: null }, 2, 3)).toMatch(/up to 3 are researched a day/)
    expect(seedStatusLabel({ status: 'failed', result: 'too short' }, 0)).toMatch(/too short/)
  })
})

describe('Start build now (idea_build_requests)', () => {
  const ROADMAP = '# Roadmap\n\n## M1 — core\n\n### M2 — more\n\n## M2 again\n'
  const repo = 'https://github.com/o/pr-split'
  const request = (over: Partial<IdeaBuildRequestRow> = {}): IdeaBuildRequestRow => ({
    id: 1, slug: 'pr-split', milestone: 'M1', note: null, status: 'pending', result: null, prUrl: null, engine: null,
    createdAt: NOW, startedAt: null, finishedAt: null, ...over,
  })
  const approved = idea('pr-split', { stage: 'repo', state: { repo, ownerApproved: true }, docs: { roadmap: ROADMAP } })

  it('reads milestones from ROADMAP.md like idea-factory', () => {
    expect(roadmapMilestones(ROADMAP)).toEqual(['M1', 'M2'])
    expect(roadmapMilestones(undefined)).toEqual([])
  })
  it('builds M1 of an approved idea with a repo, the next milestone after a merge, and nothing else', () => {
    expect(buildNowTarget(approved)).toEqual({ ok: true, milestone: 'M1' })
    expect(buildNowTarget({ ...approved, state: { repo, review: { verdict: 'validate', score: 7 } } })).toEqual({ ok: true, milestone: 'M1' })
    expect(buildNowTarget({ ...approved, state: { repo, review: { verdict: 'pass', score: 3 } } })).toMatchObject({ ok: false, reason: expect.stringMatching(/Not approved/) })
    expect(buildNowTarget(idea('x', { stage: 'pass' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/No repo yet/) })
    expect(buildNowTarget({ ...approved, state: { repo, ownerApproved: true, build: { milestone: 'M1', status: 'failed' } } })).toEqual({ ok: true, milestone: 'M1' })
    const building = { ...approved, stage: 'building' as const }
    expect(buildNowTarget({ ...building, state: { repo, build: { milestone: 'M1', status: 'running' } } })).toMatchObject({ ok: false, reason: 'M1 is being built now.' })
    expect(buildNowTarget({ ...building, state: { repo, build: { milestone: 'M1', status: 'pr-open' } } })).toMatchObject({ ok: false, reason: expect.stringMatching(/waiting for your review/) })
    expect(buildNowTarget({ ...building, state: { repo, milestonesDone: ['M1'], build: { milestone: 'M1', status: 'merged' } } })).toEqual({ ok: true, milestone: 'M2' })
    expect(buildNowTarget({ ...building, state: { repo, milestonesDone: ['M1', 'M2'], build: { milestone: 'M2', status: 'merged' } } })).toMatchObject({ ok: false, reason: expect.stringMatching(/Every roadmap milestone/) })
    // A go-live isn't on the roadmap: after one, Start build now goes back to the roadmap, live products too (idea-factory manualBuildTarget).
    const live = { ...approved, stage: 'live' as const }
    expect(buildNowTarget({ ...live, state: { repo, milestonesDone: ['M1'], build: { milestone: 'GOLIVE', status: 'failed' } } })).toEqual({ ok: true, milestone: 'M2' })
    expect(buildNowTarget({ ...live, state: { repo, milestonesDone: ['M1', 'M2'], build: { milestone: 'GOLIVE', status: 'merged' } } })).toEqual({ ok: false, reason: 'Already live.' })
    expect(buildNowTarget({ ...building, state: { repo, milestonesDone: ['M1', 'M2'], build: { milestone: 'GOLIVE', status: 'closed' } } })).toMatchObject({ ok: false, reason: expect.stringMatching(/Every roadmap milestone/) })
  })
  it('one request at a time per idea', () => {
    expect(buildNowTarget({ ...approved, buildRequests: [request()] })).toEqual({ ok: false, reason: 'A build request is already queued.' })
    expect(buildNowTarget({ ...approved, buildRequests: [request({ status: 'running' })] })).toEqual({ ok: false, reason: 'A build is running now.' })
    expect(buildNowTarget({ ...approved, buildRequests: [request({ status: 'failed' })] })).toEqual({ ok: true, milestone: 'M1' })
  })
  it('the dialog says it starts on the next run, or waits while every build slot is taken', () => {
    const policy = { build: { model: 'opus', effort: 'xhigh', claudeFallbackModel: 'sonnet', timeoutMinutes: 45 } }
    const free = buildNowSteps('M1', approved, policy, { running: 1, max: 3 })
    expect(free[0]).toBe('On its next run (within 15 min) the pipeline builds M1 in o/pr-split, alongside anything already building (up to 3 at once, each when the Mac has the memory for it).')
    expect(free[1]).toBe('Claude Code on your subscription: opus at effort xhigh. Sonnet if it’s unavailable; the free pool only if the subscription can’t take it.')
    expect(free.join(' ')).toMatch(/plan-eng-review first[\s\S]*review checklist/)
    expect(free.join(' ')).toMatch(/up to 45 minutes of your Claude Pro usage/)
    expect(buildNowSteps('M1', approved, policy, { running: 3, max: 3 })[0]).toBe('3 builds are running (the limit is 3): this one starts on the pipeline’s first run after one of them finishes.')
  })
  it('labels each request state', () => {
    expect(buildRequestLabel(request())).toMatch(/Queued: starts on the pipeline’s next run/)
    expect(buildRequestLabel(request({ result: 'waiting: 3 builds are running (the limit is 3)' }))).toBe('Queued, waiting: 3 builds are running (the limit is 3)')
    expect(buildRequestLabel(request({ status: 'running', engine: null }))).toBe('Building M1 now')
    expect(buildRequestLabel(request({ status: 'done', result: 'M1 PR opened, tests passing', engine: 'claude-opus-5-5 · xhigh' }))).toBe('M1: M1 PR opened, tests passing · claude-opus-5-5 · xhigh')
    expect(buildRequestLabel(request({ status: 'failed', result: 'Claude made no changes' }))).toBe('Failed: Claude made no changes')
    expect(buildRequestLabel(request({ status: 'cancelled' }))).toBe('Withdrawn')
  })
  it('counts the builds running now, whatever started them', () => {
    const states = [{ state: { build: { status: 'running', manual: true } } }, { state: { build: { status: 'running', milestone: 'GOLIVE' } } }, { state: { build: { status: 'merged' } } }]
    expect(buildSlot(states, POLICY)).toMatchObject({ running: 2, max: 3, free: true, autoFree: false })
    expect(buildSlot([], { build: { concurrency: { max: 1, reserveForRequests: 0 } } })).toMatchObject({ running: 0, max: 1, free: true, autoFree: true })
  })
})

describe('Build the MVP ("let it rip")', () => {
  const repo = 'https://github.com/o/dawnlog'
  const ROADMAP = '## M1\n## M2\n## M3\n'
  const approved = idea('dawnlog', { stage: 'repo', state: { repo, ownerApproved: true }, docs: { roadmap: ROADMAP } })
  it('covers every remaining milestone from where a single build would start', () => {
    expect(buildMvpTarget(approved)).toEqual({ ok: true, milestones: ['M1', 'M2', 'M3'] })
    expect(buildMvpTarget(approved, 2)).toEqual({ ok: true, milestones: ['M1', 'M2'] })
    const afterM1 = { ...approved, stage: 'building' as const, state: { repo, milestonesDone: ['M1'], build: { milestone: 'M1', status: 'merged' } } }
    expect(buildMvpTarget(afterM1)).toEqual({ ok: true, milestones: ['M2', 'M3'] })
    expect(buildMvpTarget({ ...approved, state: { repo, review: { verdict: 'pass', score: 3 } } })).toMatchObject({ ok: false, reason: expect.stringMatching(/Not approved/) })
    expect(milestoneRange(['M1', 'M2', 'M3'])).toBe('M1–M3')
    expect(milestoneRange(['M2'])).toBe('M2')
  })
  it('the dialog says it runs them one after another, how long, and where it stops', () => {
    const steps = buildMvpSteps(['M1', 'M2', 'M3'], approved, { build: { model: 'opus', effort: 'xhigh', mvp: { maxMinutes: 240 } } }, { running: 0, max: 3 })
    expect(steps[0]).toBe('On its next run (within 15 min) the pipeline builds M1, M2, M3 one after another in o/dawnlog, alongside anything already building (up to 3 at once, each when the Mac has the memory for it).')
    expect(steps[1]).toMatch(/^Claude Code on your subscription: opus at effort xhigh\./)
    expect(steps.join(' ')).toMatch(/One run in the sandbox, for up to 4 hours/)
    expect(steps.join(' ')).toMatch(/stops at the first milestone whose tests fail or that falls back off Opus/)
    expect(steps.join(' ')).toMatch(/Merging marks the completed milestones done/)
    expect(steps[steps.length - 1]).toMatch(/Opens a draft PR/)
  })
  it('labels an MVP request, and approving says it builds the MVP in MVP mode', () => {
    expect(buildRequestLabel({ status: 'running', milestone: 'MVP', result: null, engine: null })).toBe('Building the MVP now')
    expect(buildRequestLabel({ status: 'done', milestone: 'MVP', result: 'MVP (M1, M2) PR opened, tests passing', engine: null })).toBe('MVP: MVP (M1, M2) PR opened, tests passing')
    const free = { running: 0, max: 3, free: true, autoFree: true, held: null }
    expect(whatHappens('build', idea('x'), free, { build: { mode: 'mvp' } }, 0).join(' ')).toMatch(/Builds the MVP right after: every roadmap milestone in one run/)
    expect(whatHappens('build', idea('x'), free, { build: { mode: 'milestone' } }, 0).join(' ')).toMatch(/Builds M1 right after/)
  })
})

describe('launch kit order', () => {
  const kit = `# Launch kit: permitly (2026-10-12)\n\nPage: x\n\n## Order\n1. **BiggerPockets source thread** (today): no link.\n2. **r/AirBnBHosts** (tomorrow).\n\nSpace them a day apart.\n\n## 1. BiggerPockets\nhttps://example.com\n`
  it('is the Order section of the kit, up to the next heading', () => {
    expect(launchKitOrder(kit)).toBe('1. **BiggerPockets source thread** (today): no link.\n2. **r/AirBnBHosts** (tomorrow).\n\nSpace them a day apart.')
  })
  it('is null without a kit or an Order section, and reads an Order section at the end', () => {
    expect(launchKitOrder(undefined)).toBeNull()
    expect(launchKitOrder('# Kit\n\n## Dropped\n- x')).toBeNull()
    expect(launchKitOrder('# Kit\n\n## Order\n1. **HN**')).toBe('1. **HN**')
  })
})

describe('Get it launch-ready (go-live)', () => {
  const repo = 'https://github.com/o/dawnlog'
  const merged = idea('dawnlog', { stage: 'building', state: { repo, milestonesDone: ['M1'], build: { milestone: 'M1', status: 'merged' }, launch: { steps: [], next: null, done: 3, total: 10, price: '$12 once' } } })
  it('runs after M1 is merged, with nothing building or waiting for review', () => {
    expect(goLiveTarget(merged)).toEqual({ ok: true })
    expect(goLiveTarget(idea('x', { state: { repo } }))).toEqual({ ok: false, reason: 'Merge at least M1 first.' })
    expect(goLiveTarget({ ...merged, state: { ...merged.state, build: { milestone: 'GOLIVE', status: 'pr-open' } } })).toEqual({ ok: false, reason: 'The go-live PR is waiting for your review: merge it first.' })
    expect(goLiveTarget({ ...merged, buildRequests: [{ id: 1, slug: 'dawnlog', milestone: 'GOLIVE', note: null, status: 'pending', result: null, prUrl: null, engine: null, createdAt: NOW, startedAt: null, finishedAt: null }] })).toMatchObject({ ok: false })
  })
  it('the dialog lists what it adds, the price for the Buy button, and that the live site is audited after', () => {
    const steps = goLiveSteps(merged, { running: 0, max: 3 })
    expect(steps[0]).toMatch(/makes it launch-ready, in the sandbox, without changing what it does/)
    expect(steps.join(' ')).toMatch(/titles, meta descriptions, a share image, sitemap\.xml, robots\.txt/)
    expect(steps.join(' ')).toMatch(/A Buy button for \$12 once that links to your Stripe payment link \(STRIPE_PAYMENT_LINK\), hidden until you set it/)
    expect(steps[steps.length - 1]).toMatch(/audited every 6 hours on the Road to revenue card/)
    expect(goLiveSteps(idea('x'), { running: 0, max: 3 }).join(' ')).toMatch(/No price in a revenue plan yet/)
    expect(goLiveSteps(merged, { running: 3, max: 3 })[0]).toMatch(/^3 builds are running \(the limit is 3\): this one starts/)
  })
  it('labels a go-live request', () => {
    expect(buildRequestLabel({ status: 'running', milestone: 'GOLIVE', result: null, engine: null })).toBe('Making it launch-ready now')
    expect(buildRequestLabel({ status: 'done', milestone: 'GOLIVE', result: 'Go-live PR opened, tests passing', engine: null })).toBe('Go-live: Go-live PR opened, tests passing')
  })
})

describe('Growth loop on the Ideas page', () => {
  const exp = (over: Partial<GrowthExperiment> = {}): GrowthExperiment => ({ id: 'tiebreak-20261013-seo', kind: 'seo', executor: 'build', hypothesis: 'Pages bring visitors.', metric: 'visit',
    baseline: 3, target: 50, windowDays: 28, status: 'running', createdAt: '2026-10-13T10:00:00Z', startedAt: '2026-10-13T12:00:00Z', endsAt: '2026-11-10T12:00:00Z', ...over })
  it('says each experiment in one line: its kind, where it stands, baseline → target', () => {
    expect(experimentLine(exp())).toBe('search pages · running until Nov 10 · 3 visitors a week → 50 visitors a week')
    expect(experimentLine(exp({ status: 'proposed', prUrl: 'https://github.com/o/t/pull/9' }))).toBe('search pages · PR open · 3 visitors a week → 50 visitors a week')
    expect(experimentLine(exp({ status: 'measuring', endsAt: '2026-11-24T12:00:00Z', extensions: 1 }))).toBe('search pages · extended until Nov 24 for more visitors · 3 visitors a week → 50 visitors a week')
    expect(experimentLine(exp({ kind: 'kit', executor: 'claude', status: 'proposed' }))).toMatch(/^launch kit · kit ready, waiting for your first post/)
    expect(experimentLine(exp({ kind: 'landing', metric: 'activate', baseline: 0, target: 0.1, status: 'abandoned', reason: 'the PR was closed without merging' })))
      .toBe('first screen · abandoned: the PR was closed without merging · 0.0% of visitors → 10.0% of visitors')
    expect(experimentLine(exp({ kind: 'instrumentation', metric: 'beacon', baseline: 0, target: 1, status: 'decided', decision: 'keep' }))).toBe('funnel beacon · decided: keep · old beacon → beacon live')
  })
  it('a judged experiment shows what happened: the metric before and after, against its target', () => {
    expect(experimentLine(exp({ status: 'decided', decision: 'keep', result: { lift: true, value: 60, before: 3, sample: 240 } })))
      .toBe('search pages · decided: keep · 3 visitors a week → 60 visitors a week (target 50 visitors a week)')
    expect(experimentLine(exp({ kind: 'paywall', metric: 'checkout', baseline: 0.02, target: 0.05, status: 'decided', decision: 'revert', result: { lift: false, value: 0.01, before: 0.04, sample: 80 }, reverted: { at: 'x', url: 'u' } })))
      .toBe('paid offer placement · decided: revert (reverted) · 4.0% of visitors → 1.0% of visitors (target 5.0% of visitors)')
    expect(experimentLine(exp({ status: 'decided', decision: 'iterate', result: { lift: null, value: null, before: null, sample: 12, note: 'only 12 visitors in its window: not enough to judge' } })))
      .toBe('search pages · decided: iterate (only 12 visitors in its window: not enough to judge) · 3 visitors a week → 50 visitors a week')
  })
  it("says who a build's PR waits for: left for you (why), merged by the pipeline, or merging itself", () => {
    const pr = { milestone: 'GROWTH', status: 'pr-open', prUrl: 'https://github.com/o/t/pull/9' }
    const on = { autonomy: { merge: true } }
    expect(buildAutonomyNote({ ...pr, held: 'web failed' }, on)).toBe('Left for you: web failed.')
    expect(buildAutonomyNote(pr, on)).toBe('The pipeline merges it once its checks pass.')
    expect(buildAutonomyNote(pr, {})).toBeNull()
    expect(buildAutonomyNote({ ...pr, status: 'merged', mergedBy: 'agent', mergedAt: 'x' }, on)).toBe('Merged by the pipeline once its checks passed.')
    expect(buildAutonomyNote({ ...pr, status: 'merged', mergedBy: 'agent', reverted: { at: 'x', reason: "the live site's launch checks failed after it merged" } }, on))
      .toBe("Merged by the pipeline, then reverted: the live site's launch checks failed after it merged.")
    expect(buildAutonomyNote(undefined, on)).toBeNull()
  })
  it('names the next mission and who does it', () => {
    expect(nextMissionText({ kind: 'seo', executor: 'build' })).toBe('search pages (a growth build, as a draft PR)')
    expect(nextMissionText({ kind: 'kit', executor: 'claude' })).toBe('launch kit (posts drafted for you)')
    expect(nextMissionText({ kind: 'post', executor: 'owner' })).toBe('yours: post the next kit channel')
    expect(nextMissionText(null)).toMatch(/waiting for the last mission/)
    expect(GROWTH_STAGE_LABEL.instrument).toBe('Measuring the funnel')
    expect(growthKindLabel('mystery')).toBe('mystery')
  })
})

describe('the funnel beacon', () => {
  it("counts as live once it sent a visit, or once a go-live or beacon build with it merged, before the first visit", () => {
    const quiet = { d7: { visit: 0 }, seen: { visit: false } }
    expect(beaconLive({ funnel: quiet })).toBe(false)
    expect(beaconLive({ funnel: { ...quiet, seen: { visit: true } } })).toBe(true)
    expect(beaconLive({ funnel: quiet, golive: { mergedAt: 'x', beacon: 'funnel' } })).toBe(true)
    expect(beaconLive({ funnel: quiet, golive: { mergedAt: 'x' } }), 'a go-live from before the funnel beacon').toBe(false)
    const exp = (status: GrowthExperiment['status']): GrowthExperiment => ({ id: 'x', kind: 'instrumentation', executor: 'build', hypothesis: 'h', metric: 'beacon', baseline: 0, target: 1, windowDays: 7, status, createdAt: 'x' })
    expect(beaconLive({ funnel: quiet, growth: { experiments: [exp('running')] } })).toBe(true)
    expect(beaconLive({ funnel: quiet, growth: { experiments: [exp('proposed')] } }), 'its PR is still open').toBe(false)
  })
})
