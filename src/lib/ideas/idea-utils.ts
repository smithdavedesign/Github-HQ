/**
 * The Ideas page's rules, kept pure so they can be tested: which ideas need the owner, what each
 * decision would do next, the demand test's progress and how many builds are running. The shapes mirror
 * idea-factory's record (ideas/<slug>/idea.json, state.json, review.json, policy.json); keep them in
 * step with factory/context/ideas.ts and idea-factory's lib/pipeline.js.
 */

export type IdeaStage = 'idea' | 'validate' | 'build' | 'repo' | 'building' | 'live' | 'pass'
export type IdeaDecisionKind = 'build' | 'validate' | 'pass'
export type IdeaDecisionStatus = 'pending' | 'applied' | 'failed' | 'cancelled'

export interface IdeaJson {
  title?: string
  oneLiner?: string
  overlaps?: string
  tags?: string[]
  effort?: string
  confidence?: string
  sources?: string[]
  recordedAt?: string
  /** Set when the owner sent the idea (Slack, WhatsApp, the New idea box, a session). */
  seedId?: string
}

export interface IdeaStateJson {
  stage?: IdeaStage
  updatedAt?: string
  review?: { verdict: 'validate' | 'pass'; score: number; summary?: string; at?: string }
  page?: { url: string; deployedAt?: string }
  signals?: { views: number; uniqueVisitors: number; signups: number; updatedAt?: string }
  validation?: { startedAt: string; decideAfter: string; extensions?: number; decision?: 'build' | 'pass' | 'extend'; reason?: string }
  repo?: string
  build?: {
    milestone?: string; prUrl?: string; status?: string; testsPassing?: boolean; at?: string; reason?: string; manual?: boolean; engine?: string; model?: string | null; effort?: string | null
    /** An MVP run: what it set out to build, what completed (a merge marks these done), and why it stopped early. */
    planned?: string[]; milestones?: string[]; stopped?: string | null; sandbox?: string
    /** A growth build (milestone "GROWTH"): its experiment and the kind of change. */
    experiment?: string; kind?: string
    /**
     * Autonomy (idea-factory lib/autonomy.js, the owner's call on 2026-10-12): the pipeline merged its own PR,
     * left it for the owner (why), or reverted its merge because the live site broke.
     */
    mergedBy?: 'agent'; mergedAt?: string; held?: string; reverted?: { at: string; url?: string | null; reason?: string }
  }
  /** The road from M1 to the first dollar (idea-factory lib/revenue.js), refreshed every tick. */
  launch?: LaunchChecklist
  /** A built product's funnel from its beacon (docs/growth-loop-prd.md, "Measurement"). */
  funnel?: Funnel
  /** A focus product's growth record: stage, bottleneck, next mission, experiments (idea-factory step 5d). */
  growth?: GrowthState
  /** Set when a go-live PR merges. */
  golive?: { mergedAt?: string; prUrl?: string; beacon?: 'funnel' }
  milestonesDone?: string[]
  revenue?: { mrr: number; updatedAt?: string }
  ownerApproved?: boolean
  passReason?: string
  /** The owner's last decision, set by the pipeline when it applies one from this page. */
  ownerDecision?: { decision: IdeaDecisionKind; at: string; note?: string; source?: string }
}

export interface ReviewJson {
  verdict?: 'validate' | 'pass'
  score?: number
  summary?: string
  forcingQuestions?: Record<string, { score: number; evidence: string }>
  premises?: string[]
  alternatives?: string[]
  wedge?: string
  feasibility?: { zeroCost?: boolean; m1Weekend?: boolean; notes?: string }
  risks?: string[]
  killCriteria?: string
  landing?: { headline?: string; subhead?: string; bullets?: string[]; cta?: string }
  launch?: { channels?: { name: string; url?: string; why?: string }[]; post?: string }
}

export interface IdeaDocs { research?: string; prd?: string; roadmap?: string; review?: string; launch?: string; build?: string; revenue?: string; launchKit?: string; learnings?: string }

/**
 * The "## Order" section of an idea's launch kit (LAUNCH-KIT.md, written by the launch skill): the
 * channels checked to exist and allow the post, in posting order. The review's channels are
 * unchecked guesses (permitly's named subreddits that don't exist), so the page prefers this.
 */
export function launchKitOrder(kit: string | undefined): string | null {
  if (!kit) return null
  const m = /^##\s+Order\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(kit)
  const body = m?.[1].trim()
  return body ? body : null
}

/** Unique visitors per event; signups are distinct emails. */
export interface FunnelCounts { visit?: number; signup?: number; activate?: number; checkout?: number }
/** Saved by the pipeline for built products: the last 7 days, the 7 before, all time, and where visitors came from. */
export interface Funnel {
  at?: string; d7?: FunnelCounts; prev7?: FunnelCounts; all?: FunnelCounts; referrers7d?: { host: string; visitors: number }[]
  /** Visitors left out this week as a burst of direct visits that did nothing (idea-factory lib/repohq.js cleanSignals). */
  burst7d?: number
  /** Which events the product's beacon has ever sent: no `visit` means it still runs the old one-view beacon. */
  seen?: { visit?: boolean; activate?: boolean; checkout?: boolean }
}

export type GrowthMetric = 'beacon' | 'visit' | 'activate' | 'checkout'

/** One growth-loop experiment (idea-factory lib/growth.js newExperiment, judged when its window ends). */
export interface GrowthExperiment {
  id: string; kind: string; executor: 'build' | 'claude'; hypothesis: string; metric: GrowthMetric
  baseline: number; target: number; windowDays: number
  status: 'proposed' | 'running' | 'measuring' | 'decided' | 'abandoned'
  createdAt: string; updatedAt?: string; startedAt?: string; endsAt?: string
  prUrl?: string; reason?: string; channels?: number; artifact?: string
  /** abandoned because its build or PR failed: the mission is tried again the next day. */
  failed?: boolean
  extensions?: number
  /** The judge's verdict (idea-factory lib/growth.js judge): the metric before and after, and what else ran alongside. */
  decision?: 'keep' | 'iterate' | 'revert' | 'park'; decidedAt?: string
  result?: { lift?: boolean | null; value?: number | null; before?: number | null; sample?: number; note?: string; ranWith?: string[] }
  /** A revert decision the pipeline carried out: its revert PR. */
  reverted?: { at: string; url?: string | null }
  /** A feature from the weekly plan: the plan item it built. */
  planItem?: string; title?: string; payments?: boolean
}

/** One feature in a product's weekly plan (idea-factory lib/plan.js): what to build, the number it should move, how to check it. */
export interface PlanItem {
  id: string; title: string; why?: string; metric: GrowthMetric; acceptance: string[]
  windowDays?: number; size?: 'S' | 'M' | 'L'; payments?: boolean; target?: number
  /** The experiments its builds started, newest last. */
  attempts?: string[]
}
export interface GrowthPlan { at: string; items: PlanItem[]; errors?: string[] }

export type PlanItemStatus = 'planned' | 'building' | 'shipped' | 'decided' | 'failed' | 'dropped'

/** Where a plan item stands, from its builds' experiments, as idea-factory's itemStatus says it. */
export function planItemStatus(item: PlanItem, experiments: GrowthExperiment[] = []): PlanItemStatus {
  const attempts = (item.attempts ?? []).map(id => experiments.find(e => e.id === id)).filter((e): e is GrowthExperiment => !!e)
  const last = attempts.at(-1)
  if (!last) return 'planned'
  if (last.status === 'proposed') return 'building'
  if (last.status === 'running' || last.status === 'measuring') return 'shipped'
  if (last.status === 'decided') return 'decided'
  if (last.status === 'abandoned' && last.failed) return attempts.filter(e => e.status === 'abandoned' && e.failed).length >= 3 ? 'dropped' : 'failed'
  return 'dropped'
}

/**
 * The feature loop over the last 7 days across products (pure): features whose build opened a PR, merged ones (their
 * experiment started), and judged ones with how their numbers moved.
 */
export function featureWeek(growths: Array<{ name: string; growth?: GrowthState }>, now = new Date()): { built: number; merged: number; judged: string[] } {
  const since = now.getTime() - 7 * 86_400_000
  const recent = (t?: string) => !!t && new Date(t).getTime() >= since
  let built = 0, merged = 0
  const judged: string[] = []
  for (const { name, growth } of growths) {
    for (const e of growth?.experiments ?? []) {
      if (e.kind !== 'feature') continue
      if (e.prUrl && recent(e.createdAt)) built++
      if (recent(e.startedAt)) merged++
      if (e.status === 'decided' && recent(e.decidedAt)) {
        const moved = e.result?.value === null || e.result?.value === undefined ? (e.result?.note ?? 'no reading') : `${growthValue(e.metric, e.result.before ?? e.baseline)} → ${growthValue(e.metric, e.result.value)}`
        judged.push(`${name}: ${e.title ?? e.planItem ?? e.id} ${e.decision} (${moved})`)
      }
    }
  }
  return { built, merged, judged }
}

/** A focus product's growth record, refreshed every pipeline tick (idea-factory step 5d). */
export interface GrowthState {
  stage?: 'launch' | 'instrument' | 'acquire' | 'activate' | 'monetize' | 'retain' | 'park'
  bottleneck?: string
  /** This week's plan of features (idea-factory lib/plan.js), built one a night. */
  plan?: GrowthPlan
  planFailedAt?: string
  /** The next mission; null while the last one's result is pending. */
  next?: { kind: string; executor: 'build' | 'claude' | 'owner'; metric?: string } | null
  experiments?: GrowthExperiment[]
  checkedAt?: string
}

export const GROWTH_STAGE_LABEL: Record<NonNullable<GrowthState['stage']>, string> = {
  launch: 'Getting launch-ready', instrument: 'Measuring the funnel', acquire: 'Getting visitors', activate: 'Getting first use',
  monetize: 'Getting paid', retain: 'Keeping buyers', park: 'Park it?',
}
const GROWTH_KIND_LABEL: Record<string, string> = {
  instrumentation: 'funnel beacon', kit: 'launch kit', seo: 'search pages', landing: 'first screen', paywall: 'paid offer placement',
  post: 'post the next kit channel', park: 'decide whether to park it', feature: 'feature',
}
/** "search pages" for "seo"; unknown kinds as they are. */
export const growthKindLabel = (kind: string) => GROWTH_KIND_LABEL[kind] ?? kind

/** "3 visitors a week", "8.0% of visitors", "beacon live", as idea-factory's valueText says it. */
export function growthValue(metric: GrowthMetric, v: number): string {
  if (metric === 'beacon') return v ? 'beacon live' : 'old beacon'
  if (metric === 'visit') return `${v} visitor${v === 1 ? '' : 's'} a week`
  return `${(v * 100).toFixed(1)}% of visitors`
}

/** The next mission in words, with who does it. */
export function nextMissionText(next: GrowthState['next']): string {
  if (!next) return 'waiting for the last mission’s result'
  if (next.executor === 'owner') return `yours: ${growthKindLabel(next.kind)}`
  return `${growthKindLabel(next.kind)} (${next.executor === 'build' ? 'a growth build, as a draft PR' : 'posts drafted for you'})`
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * One line per experiment: "search pages · running until Nov 10 · 3 visitors a week → 50 visitors a week"
 * (baseline → target). A judged one shows what happened instead: "· decided: keep · 3 visitors a week →
 * 60 visitors a week (target 50 visitors a week)". A growth PR merges itself once its checks pass, so an open
 * one is just "PR open".
 */
export function experimentLine(e: GrowthExperiment): string {
  const label = growthKindLabel(e.kind)
  if (e.status === 'decided' && typeof e.result?.value === 'number') {
    const before = e.result.before ?? e.baseline
    return `${label} · decided: ${e.decision ?? '?'}${e.reverted ? ' (reverted)' : ''} · ${growthValue(e.metric, before)} → ${growthValue(e.metric, e.result.value)} (target ${growthValue(e.metric, e.target)})`
  }
  const when = e.status === 'running' && e.endsAt ? `running until ${shortDay(e.endsAt)}`
    : e.status === 'measuring' && e.endsAt ? `extended until ${shortDay(e.endsAt)} for more visitors`
    : e.status === 'proposed' ? (e.executor === 'build' ? (e.prUrl ? 'PR open' : 'being built') : 'kit ready, waiting for your first post')
    : e.status === 'abandoned' ? `abandoned${e.reason ? `: ${e.reason}` : ''}`
    : e.status === 'decided' ? `decided: ${e.decision ?? '?'}${e.result?.note ? ` (${e.result.note})` : ''}` : e.status
  return `${label} · ${when} · ${growthValue(e.metric, e.baseline)} → ${growthValue(e.metric, e.target)}`
}

/**
 * Whether the product runs the funnel beacon (idea-factory lib/growth.js beaconLive): it has sent a visit,
 * its go-live was built with the funnel beacon, or a funnel-beacon growth build merged. A product with a
 * handful of visitors can go days between the merge and its first visit.
 */
export function beaconLive(s: Pick<IdeaStateJson, 'funnel' | 'golive' | 'growth'>): boolean {
  if (s.funnel?.seen?.visit || s.golive?.beacon === 'funnel') return true
  return (s.growth?.experiments ?? []).some(e => e.kind === 'instrumentation' && (e.status === 'running' || e.status === 'measuring' || e.status === 'decided'))
}

/** "3 visitors this week (0 the week before), 0 activations, 0 Buy clicks", as idea-factory's funnelText says it. */
export function funnelSummary(f: Funnel): string {
  const n = (x: number | undefined, w: string) => `${x ?? 0} ${w}${x === 1 ? '' : 's'}`
  return `${n(f.d7?.visit, 'visitor')} this week (${f.prev7?.visit ?? 0} the week before), ${n(f.d7?.activate, 'activation')}, ${n(f.d7?.checkout, 'Buy click')}`
    + (f.burst7d ? ` (${f.burst7d} more left out: a burst of direct visits that did nothing, likely crawlers or a test)` : '')
}

export interface LaunchStep { id: string; label: string; owner: 'agent' | 'david'; done: boolean; evidence?: string }
export interface LaunchChecklist {
  steps: LaunchStep[]
  next: { id: string; label: string; owner: 'agent' | 'david' } | null
  done: number
  total: number
  buyer?: string
  price?: string
  updatedAt?: string
}

export interface IdeaPolicy {
  review?: { minScore?: number; maxPerDay?: number }
  validation?: {
    days?: number; maxValidating?: number; minVisitorsToJudge?: number; maxExtensions?: number
    build?: { minSignups?: number; minSignupRate?: number }
    buildEarly?: { minSignups?: number; minSignupRate?: number }
  }
  build?: {
    engine?: string; model?: string; effort?: string; claudeFallbackModel?: string; timeoutMinutes?: number; mode?: 'mvp' | 'milestone'; mvp?: { maxMilestones?: number; maxMinutes?: number; stopOnFallback?: boolean }
    /** How many builds run at once (no daily or weekly cap since 2026-10-13); builds the pipeline starts itself leave reserveForRequests slots for Start build now. */
    concurrency?: { max?: number; reserveForRequests?: number; reserveMemoryMb?: number; minFreeMemoryPct?: number; retryAfterHours?: number }
    /** false: ideas never built wait for their first build until a focus product has traction (newBuildsHold). */
    startNew?: boolean
  }
  research?: { seeded?: { maxPerDay?: number; retryMinutes?: number } }
  /** The growth loop (docs/growth-loop-prd.md): the products it works on, and the traction bar. */
  growth?: { focus?: string[]; minVisitorsPerWeek?: number }
  /** Autonomy (idea-factory lib/autonomy.js): the pipeline merges its own green PRs and reverts what breaks. */
  autonomy?: { merge?: boolean; revert?: boolean }
}

/**
 * Who a build's PR waits for, and what happened to it (pure): "left for you: <why>" when the pipeline held
 * it, "merged by the pipeline" (then reverted, and why), or, with autonomy on, that it merges itself once
 * its checks pass. null when there's nothing to say.
 */
export function buildAutonomyNote(build: IdeaStateJson['build'], policy: IdeaPolicy | null): string | null {
  if (!build) return null
  if (build.reverted) return `Merged by the pipeline, then reverted: ${build.reverted.reason ?? 'it broke the live site'}.`
  if (build.mergedBy === 'agent') return 'Merged by the pipeline once its checks passed.'
  if (build.status !== 'pr-open' || !build.prUrl) return null
  if (build.held) return `Left for you: ${build.held}.`
  return policy?.autonomy?.merge ? 'The pipeline merges it once its checks pass.' : null
}

export interface IdeaDecisionRow {
  id: number
  slug: string
  decision: IdeaDecisionKind
  note: string | null
  status: IdeaDecisionStatus
  result: string | null
  createdAt: Date
  appliedAt: Date | null
}

export type IdeaBuildRequestStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

/** "Start build now" (idea_build_requests): the pipeline builds the milestone on its next run with a free build slot. */
export interface IdeaBuildRequestRow {
  id: number
  slug: string
  milestone: string | null
  note: string | null
  status: IdeaBuildRequestStatus
  result: string | null
  prUrl: string | null
  engine: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

export interface Signals { views: number; uniqueVisitors: number; signups: number }

/** One idea as the page sees it: the synced record, live demand signals and the owner's decisions. */
export interface IdeaView {
  slug: string
  title: string
  stage: IdeaStage
  idea: IdeaJson
  state: IdeaStateJson
  review: ReviewJson | null
  docs: IdeaDocs
  updatedAt: Date | null
  /** Live counts from idea_signals (the synced state lags by up to a tick). */
  signals: Signals | null
  /** Newest first. */
  decisions: IdeaDecisionRow[]
  /** "Start build now" requests for this idea, newest first. */
  buildRequests: IdeaBuildRequestRow[]
}

const DAY = 86_400_000
/** The idea's git record: idea-factory's ideas/<slug>/. */
export const ideaRecordUrl = (slug: string) => `https://github.com/smithdavedesign/idea-factory/tree/main/ideas/${encodeURIComponent(slug)}`
/** A review the pipeline acted on by itself stays in "needs you" this long, so you can overrule it. */
export const RECENT_REVIEW_DAYS = 14
/** The pipeline ticks every 15 minutes; past this its heartbeat counts as stale. */
export const PIPELINE_STALE_MINUTES = 60

const DEFAULTS = {
  maxConcurrent: 3, reserveForRequests: 1, maxValidating: 5, days: 14, minVisitorsToJudge: 50,
  build: { minSignups: 5, minSignupRate: 0.05 }, buildEarly: { minSignups: 10, minSignupRate: 0.08 },
}

/** The Ideas page, linked from the morning report. */
export const IDEAS_PAGE_URL = 'https://repohq.vercel.app/ideas'

/** "permitly — permit and rule-change tracker…" → "permitly". */
export function shortTitle(title: string): string {
  return title.split(' — ')[0]!.trim()
}

/** The part of the title after the name, else the one-liner. */
export function tagline(v: Pick<IdeaView, 'title' | 'idea'>): string {
  const [, rest] = v.title.split(' — ')
  return (rest ?? v.idea.oneLiner ?? '').trim()
}

export const STAGE_LABEL: Record<IdeaStage, string> = {
  idea: 'Awaiting review', validate: 'Demand test', build: 'Approved', repo: 'Repo created',
  building: 'Building', live: 'Live', pass: 'Passed',
}

export const DECISION_LABEL: Record<IdeaDecisionKind, string> = {
  build: 'Approve build', validate: 'Demand test first', pass: 'Pass',
}

/** The button for a decision on this idea: on an idea the review already passed, Pass means "agree". */
export function decisionLabel(kind: IdeaDecisionKind, stage: IdeaStage): string {
  return kind === 'pass' && stage === 'pass' ? 'Agree, keep passed' : DECISION_LABEL[kind]
}

export function pendingDecision(v: Pick<IdeaView, 'decisions'>): IdeaDecisionRow | null {
  return v.decisions.find(d => d.status === 'pending') ?? null
}

/** The owner has already decided this idea (a decision from this page that the pipeline applied). */
export function ownerDecided(v: Pick<IdeaView, 'decisions' | 'state'>): boolean {
  return v.decisions.some(d => d.status === 'applied') || !!v.state.ownerDecision || v.state.passReason === 'owner' || v.state.ownerApproved === true
}

/**
 * Needs the owner: not yet reviewed, or passed recently by the review alone, so the owner can
 * agree or overrule it. A running demand test is listed with the tests (the pipeline decides it).
 */
export function needsDecision(v: Pick<IdeaView, 'stage' | 'state' | 'decisions'>, now: Date): boolean {
  if (pendingDecision(v) || ownerDecided(v)) return false
  if (v.stage === 'idea') return true
  if (v.stage !== 'pass') return false
  const at = v.state.review?.at
  return !!at && now.getTime() - new Date(at).getTime() < RECENT_REVIEW_DAYS * DAY
}

export type IdeaGroup = 'decide' | 'testing' | 'building' | 'live' | 'passed'

export const GROUP_ORDER: IdeaGroup[] = ['decide', 'testing', 'building', 'live', 'passed']

export const GROUP_LABEL: Record<IdeaGroup, { title: string; blurb: string }> = {
  decide: { title: 'Needs your call', blurb: 'New and recently reviewed ideas. Approve, send to a demand test, or pass.' },
  testing: { title: 'Demand tests', blurb: 'Landing pages counting visitors and signups. The pipeline decides at the deadline.' },
  building: { title: 'Building', blurb: 'Approved ideas: repo, milestone PRs for you to merge.' },
  live: { title: 'Live', blurb: 'Shipped, with MRR from RepoHQ.' },
  passed: { title: 'Passed', blurb: 'Not now. Research never proposes these again, but you can still approve one.' },
}

export function ideaGroup(v: IdeaView, now: Date): IdeaGroup {
  if (needsDecision(v, now)) return 'decide'
  switch (v.stage) {
    case 'idea': return 'decide'
    case 'validate': return 'testing'
    case 'build': case 'repo': case 'building': return 'building'
    case 'live': return 'live'
    case 'pass': return 'passed'
  }
}

/** Group, then best first within a group: highest review score, then newest. */
export function groupIdeas(views: IdeaView[], now: Date): Record<IdeaGroup, IdeaView[]> {
  const out: Record<IdeaGroup, IdeaView[]> = { decide: [], testing: [], building: [], live: [], passed: [] }
  for (const v of views) out[ideaGroup(v, now)].push(v)
  const recency = (v: IdeaView) => new Date(v.state.review?.at ?? v.idea.recordedAt ?? 0).getTime()
  for (const g of GROUP_ORDER) out[g].sort((a, b) => (b.state.review?.score ?? -1) - (a.state.review?.score ?? -1) || recency(b) - recency(a))
  return out
}

/** The review queue the detail page steps through (←/→): the ideas that need a call, in list order. */
export function reviewQueue(views: IdeaView[], now: Date): string[] {
  return groupIdeas(views, now).decide.map(v => v.slug)
}

export type DecisionCheck = { ok: true } | { ok: false; reason: string }

/** Which decisions the pipeline can act on from this stage (idea-factory applyDecision, the same rules). */
export function checkDecision(v: Pick<IdeaView, 'stage' | 'state' | 'review'>, decision: IdeaDecisionKind): DecisionCheck {
  switch (decision) {
    case 'build':
      if (['idea', 'validate', 'pass'].includes(v.stage)) return { ok: true }
      // A repo made without an approval (the review said pass) still needs one for its M1 build.
      if (v.stage === 'repo' && !v.state.ownerApproved && !v.state.build) return { ok: true }
      return { ok: false, reason: v.stage === 'live' ? 'Already live.' : 'Already approved and past the build decision.' }
    case 'validate':
      if (v.stage === 'validate') return { ok: false, reason: 'The demand test is already running.' }
      if (!['idea', 'pass'].includes(v.stage)) return { ok: false, reason: 'Only an idea that is not yet being built can go to a demand test.' }
      if (!v.review?.landing) return { ok: false, reason: 'A demand test needs the review’s landing-page copy. The review runs daily at 09:30.' }
      return { ok: true }
    case 'pass':
      // Agreeing with the review's pass takes the idea off "Needs your call".
      if (v.stage === 'pass') return v.state.passReason === 'owner' || v.state.ownerDecision ? { ok: false, reason: 'Already passed by you.' } : { ok: true }
      if (v.stage === 'building' || v.stage === 'live') return { ok: false, reason: 'It has a repo with work in it: archive the repo in RepoHQ instead.' }
      return { ok: true }
  }
}

/** Roadmap builds (M1, M2…, MVP) move an idea along its roadmap; go-live and growth builds don't (idea-factory isRoadmapBuild). */
export const isRoadmapBuild = (milestone: string | null | undefined) => milestone !== 'GOLIVE' && milestone !== 'GROWTH'

/**
 * Why ideas that have never been built wait for their first build, or null when they don't
 * (idea-factory lib/pipeline.js newBuildsHeld): policy.build.startNew false holds them until a focus
 * product reaches policy.growth.minVisitorsPerWeek unique visitors in its last 7 days.
 */
export function newBuildsHold(views: ({ slug?: string } & Pick<IdeaView, 'state'>)[], policy: IdeaPolicy | null): string | null {
  if (policy?.build?.startNew !== false) return null
  const focus = policy.growth?.focus ?? []
  const bar = policy.growth?.minVisitorsPerWeek ?? 50
  const visits = (slug: string) => views.find(v => v.slug === slug)?.state.funnel?.d7?.visit ?? 0
  if (focus.some(slug => visits(slug) >= bar)) return null
  return `new builds wait until ${focus.length ? focus.join(' or ') : 'a focus product'} has ${bar} visitors a week`
}

/**
 * Builds running now against policy.build.concurrency.max: idea-factory runs them side by side, with no daily
 * or weekly cap (2026-10-13). `free`: a Start build now request would start on the next run; `autoFree`: so
 * would a build the pipeline starts itself (it leaves the last reserveForRequests slots for requests).
 * `held`: why ideas never built wait for their first build (newBuildsHold), else null. The pipeline also
 * waits for free memory (lib/build-slots.js), which the page can't see.
 */
export interface BuildSlot { running: number; max: number; free: boolean; autoFree: boolean; held: string | null }

export function buildSlot(views: ({ slug?: string; buildRequests?: Pick<IdeaBuildRequestRow, 'status'>[] } & Pick<IdeaView, 'state'>)[], policy: IdeaPolicy | null): BuildSlot {
  const c = policy?.build?.concurrency
  const max = c?.max ?? DEFAULTS.maxConcurrent
  // The record says "running" once the build has cloned its repo; a request says so as soon as it's claimed.
  const running = views.filter(v => v.state.build?.status === 'running' || (v.buildRequests ?? []).some(r => r.status === 'running')).length
  return { running, max, free: running < max, autoFree: running < max - (c?.reserveForRequests ?? DEFAULTS.reserveForRequests), held: newBuildsHold(views, policy) }
}

export interface DemandProgress {
  visitors: number
  signups: number
  /** Signups per unique visitor, 0..1. */
  rate: number
  minVisitors: number
  target: { signups: number; rate: number }
  early: { signups: number; rate: number }
  daysLeft: number | null
  /** One sentence: where the test stands and what would move it. */
  status: string
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Where a demand test stands against policy.json (idea-factory decideValidation). */
export function demandProgress(signals: Signals | null, state: IdeaStateJson, policy: IdeaPolicy | null, now: Date): DemandProgress {
  const v = policy?.validation
  const minVisitors = v?.minVisitorsToJudge ?? DEFAULTS.minVisitorsToJudge
  const target = { signups: v?.build?.minSignups ?? DEFAULTS.build.minSignups, rate: v?.build?.minSignupRate ?? DEFAULTS.build.minSignupRate }
  const early = { signups: v?.buildEarly?.minSignups ?? DEFAULTS.buildEarly.minSignups, rate: v?.buildEarly?.minSignupRate ?? DEFAULTS.buildEarly.minSignupRate }
  const s = signals ?? state.signals ?? { views: 0, uniqueVisitors: 0, signups: 0 }
  const visitors = s.uniqueVisitors
  const rate = visitors ? s.signups / visitors : 0
  const deadline = state.validation?.decideAfter ? new Date(state.validation.decideAfter) : null
  const daysLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / DAY)) : null
  let status: string
  if (s.signups >= early.signups && rate >= early.rate) status = `Strong early signal: the pipeline approves the build on its next run.`
  else if (visitors < minVisitors) status = `${visitors} of the ${minVisitors} visitors needed before the test can judge. Traffic is the bottleneck: post the launch post.`
  else if (s.signups >= target.signups && rate >= target.rate) status = `On track to build at the deadline (${s.signups} signups, ${pct(rate)}).`
  else status = `Below the bar so far: ${s.signups} of ${target.signups} signups at ${pct(rate)} (needs ${pct(target.rate)}).`
  return { visitors, signups: s.signups, rate, minVisitors, target, early, daysLeft, status }
}

export interface PipelineHealth { stale: boolean; label: string }

export function pipelineHealth(tickAt: Date | null, ok: boolean | null, now: Date): PipelineHealth {
  if (!tickAt) return { stale: true, label: 'The idea pipeline has not synced yet: decisions wait until it does.' }
  const mins = Math.round((now.getTime() - tickAt.getTime()) / 60_000)
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
  if (mins > PIPELINE_STALE_MINUTES) return { stale: true, label: `Pipeline last ran ${ago}: decisions wait until it runs again (launchd com.user.idea-pipeline on the Mac).` }
  return { stale: false, label: `Pipeline ran ${ago}${ok === false ? ' with errors' : ''}. Decisions apply on its next run (every 15 min).` }
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** What happens after each decision, in order, for the confirm dialog. */
export function whatHappens(decision: IdeaDecisionKind, v: Pick<IdeaView, 'slug' | 'stage' | 'state'>, slot: BuildSlot, policy: IdeaPolicy | null, validating: number): string[] {
  switch (decision) {
    case 'build': {
      const repo = v.state.repo ? `Uses the existing repo ${v.state.repo.replace('https://github.com/', '')}.` : `Creates the private repo ${v.slug} (topic “idea”) on the same run.`
      const when = slot.held
        ? `Its first build waits: ${slot.held}. Start build now builds it sooner, once the repo exists.`
        : slot.autoFree
        ? (policy?.build?.mode === 'mvp'
          ? 'Builds the MVP right after: every roadmap milestone in one run on your Claude subscription (Opus at extra-high effort), each with a gstack plan and tests first. It stops at the first milestone whose tests fail.'
          : 'Builds M1 right after, on your Claude subscription (Opus at extra-high effort; the free pool only if it’s out of capacity): a gstack plan, tests first, then code until they pass.')
        : `${slot.running} builds are running (up to ${slot.max} at once, the last slot kept for Start build now): its first build starts when one finishes${slot.free ? ', or right away with Start build now once the repo exists' : ''}.`
      return [
        'On its next run (within 15 min) the pipeline applies it.',
        repo,
        when,
        'Your note, if you add one, goes to the builder with the PRD.',
        'Opens a PR (branch m1), which the pipeline merges once its tests and every check pass. Each merged milestone starts the next one in the roadmap.',
        'Hosting starts on free tiers; anything paid waits for your OK (policy ownerBudget).',
      ]
    }
    case 'validate': {
      const max = policy?.validation?.maxValidating ?? DEFAULTS.maxValidating
      const days = policy?.validation?.days ?? DEFAULTS.days
      return [
        'On its next run (within 15 min) the pipeline applies it.',
        validating >= max
          ? `${validating} demand tests are already running (the cap is ${max}): its landing page waits for a free slot.`
          : 'Its landing page goes live on the free idea-pages site at the next daily run (09:30), with a launch post to share.',
        `For ${days} days visitors and waitlist signups are counted; the pipeline then builds or passes it by policy.json.`,
      ]
    }
    case 'pass':
      if (v.stage === 'pass') return ['Records that you agree with the review’s pass: the idea leaves “Needs your call”.', 'Nothing else changes. You can still approve it later.']
      return [
        'On its next run (within 15 min) the pipeline applies it.',
        v.stage === 'validate' ? 'Its demand test stops counting toward a decision.' : 'Nothing is built.',
        'Research never proposes it again. You can still approve it from the Passed list.',
      ]
  }
}

/** Only http(s) links from model-written records are rendered as links. */
export function safeUrl(u: string | undefined | null): string | null {
  if (!u) return null
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Score colour band: the review bar is policy.review.minScore (6). */
export function scoreTone(score: number | undefined, policy: IdeaPolicy | null): 'good' | 'mid' | 'low' | 'none' {
  if (score === undefined) return 'none'
  const bar = policy?.review?.minScore ?? 6
  return score >= bar ? 'good' : score >= bar - 2 ? 'mid' : 'low'
}

export type IdeaSeedStatus = 'pending' | 'queued' | 'researched' | 'failed' | 'cancelled'

export interface IdeaSeedRow {
  id: number
  text: string
  status: IdeaSeedStatus
  seedId: string | null
  slug: string | null
  result: string | null
  createdAt: Date
  queuedAt: Date | null
  researchedAt: Date | null
}

/** Same bounds as idea-factory's `idea-publish.js seed`: 8–2000 characters, an "idea:" prefix dropped. */
export const SEED_MIN = 8
export const SEED_MAX = 2000

export function cleanIdeaText(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const t = String(text ?? '').replace(/^\s*idea:\s*/i, '').trim()
  if (t.length < SEED_MIN) return { ok: false, reason: `Describe the idea in at least ${SEED_MIN} characters.` }
  return { ok: true, text: t.slice(0, SEED_MAX) }
}

/** Where a submitted idea stands, in one line. */
/** `perDay`: policy.research.seeded.maxPerDay, as the pipeline last published it. */
export function seedStatusLabel(s: Pick<IdeaSeedRow, 'status' | 'result'>, ahead: number, perDay = 10): string {
  switch (s.status) {
    case 'pending': return 'Waiting for the pipeline (within 15 min)'
    case 'queued': return ahead > 0 ? `In the research queue, ${ahead} ahead of it: up to ${perDay} are researched a day, each as soon as the one before is done` : 'Next in the research queue: researched and reviewed within about half an hour'
    case 'researched': return 'Researched'
    case 'failed': return `Couldn’t be queued: ${s.result ?? 'see the pipeline log'}`
    case 'cancelled': return 'Withdrawn'
  }
}

/** ROADMAP.md's milestones in order ("## M1 …", "## M2 …"), as idea-factory reads them. */
export function roadmapMilestones(md: string | undefined): string[] {
  const out: string[] = []
  for (const m of String(md ?? '').matchAll(/^#{2,3}\s*(M\d+)\b/gm)) if (!out.includes(m[1]!)) out.push(m[1]!)
  return out
}

export type BuildNowTarget = { ok: true; milestone: string } | { ok: false; reason: string }

/**
 * What "Start build now" would build, or why it can't. The same rules as idea-factory's
 * manualBuildTarget (bin/idea-build.js), which has the last word when the request runs.
 */
export function buildNowTarget(v: Pick<IdeaView, 'stage' | 'state' | 'docs' | 'buildRequests'>): BuildNowTarget {
  const open = v.buildRequests.find(r => r.status === 'pending' || r.status === 'running')
  if (open) return { ok: false, reason: open.status === 'running' ? 'A build is running now.' : 'A build request is already queued.' }
  const s = v.state
  const b = s.build ?? {}
  if (!s.repo) return { ok: false, reason: 'No repo yet: approve the build first, and the pipeline creates it.' }
  if (b.status === 'running') return { ok: false, reason: `${b.milestone ?? 'M1'} is being built now.` }
  if (b.status === 'pr-open') return { ok: false, reason: `${b.milestone ?? 'M1'}’s PR is waiting for your review: merge it first.` }
  if (v.stage === 'repo') {
    const approved = s.ownerApproved === true || s.validation?.decision === 'build' || (!!s.review && s.review.verdict !== 'pass')
    if (!approved) return { ok: false, reason: 'Not approved yet: approve the build first.' }
    return { ok: true, milestone: b.status === 'failed' && b.milestone ? b.milestone : 'M1' }
  }
  // A live product can still have roadmap milestones left. A go-live or growth build isn't on the roadmap,
  // so after one (merged or not) the next roadmap milestone is what's left to build.
  if ((v.stage === 'building' || v.stage === 'live') && (b.status === 'merged' || b.status === 'failed' || b.status === 'closed')) {
    if (b.status !== 'merged' && isRoadmapBuild(b.milestone)) return { ok: true, milestone: b.milestone ?? 'M1' }
    const next = roadmapMilestones(v.docs.roadmap).find(m => !(s.milestonesDone ?? []).includes(m))
    return next ? { ok: true, milestone: next } : { ok: false, reason: v.stage === 'live' ? 'Already live.' : 'Every roadmap milestone is merged.' }
  }
  return { ok: false, reason: v.stage === 'live' ? 'Already live.' : 'Nothing to build yet.' }
}

/** Every build slot is taken: the request waits its turn. */
function queuedBehind(slot: Pick<BuildSlot, 'running' | 'max'>): string {
  return `${slot.running} builds are running (the limit is ${slot.max}): this one starts on the pipeline’s first run after one of them finishes.`
}

/** What happens after "Start build now", in order, for the confirm dialog. */
export function buildNowSteps(milestone: string, v: Pick<IdeaView, 'state'>, policy: IdeaPolicy | null, slot: Pick<BuildSlot, 'running' | 'max'>): string[] {
  const b = policy?.build
  const repo = v.state.repo ? v.state.repo.replace('https://github.com/', '') : 'its repo'
  return [
    slot.running >= slot.max
      ? queuedBehind(slot)
      : `On its next run (within 15 min) the pipeline builds ${milestone} in ${repo}, alongside anything already building (up to ${slot.max} at once, each when the Mac has the memory for it).`,
    `Claude Code on your subscription: ${b?.model ?? 'opus'} at effort ${b?.effort ?? 'xhigh'}. ${b?.claudeFallbackModel ? `${b.claudeFallbackModel[0]!.toUpperCase()}${b.claudeFallbackModel.slice(1)} if it’s unavailable; ` : ''}the free pool only if the subscription can’t take it.`,
    'It plans with gstack’s plan-eng-review first, writes failing tests, codes until they pass, then checks its own diff against gstack’s review checklist.',
    `It can use up to ${b?.timeoutMinutes ?? 45} minutes of your Claude Pro usage, which your own sessions share.`,
    'Opens a draft PR for you to merge and posts it in Slack. Merging it unlocks the next milestone.',
  ]
}

/** Where a build request stands, in one line. */
export function buildRequestLabel(r: Pick<IdeaBuildRequestRow, 'status' | 'milestone' | 'result' | 'engine'>): string {
  if (r.milestone === 'GOLIVE' && r.status === 'running') return `Making it launch-ready now${r.engine ? ` (${r.engine})` : ''}`
  if (r.milestone === 'GOLIVE' && r.status === 'done') return `Go-live: ${r.result ?? 'PR opened'}${r.engine ? ` · ${r.engine}` : ''}`
  const m = r.milestone === 'MVP' ? 'the MVP' : r.milestone ?? 'The build'
  switch (r.status) {
    case 'pending': return r.result?.startsWith('waiting') ? `Queued, ${r.result}` : 'Queued: starts on the pipeline’s next run (within 15 min)'
    case 'running': return `Building ${m} now${r.engine ? ` (${r.engine})` : ''}`
    case 'done': return `${r.milestone === 'MVP' ? 'MVP' : m}: ${r.result ?? 'PR opened'}${r.engine ? ` · ${r.engine}` : ''}`
    case 'failed': return `Failed: ${r.result ?? 'see the pipeline log'}`
    case 'cancelled': return 'Withdrawn'
  }
}

export type MvpTarget = { ok: true; milestones: string[] } | { ok: false; reason: string }

/**
 * What "Build the MVP" would build: from where a single build would start, every remaining roadmap
 * milestone (idea-factory mvpMilestones, which decides when the request runs).
 */
export function buildMvpTarget(v: Pick<IdeaView, 'stage' | 'state' | 'docs' | 'buildRequests'>, max = 6): MvpTarget {
  const t = buildNowTarget(v)
  if (!t.ok) return t
  const all = roadmapMilestones(v.docs.roadmap)
  if (!all.length) return { ok: true, milestones: [t.milestone] }
  const done = new Set(v.state.milestonesDone ?? [])
  const list = all.slice(Math.max(0, all.indexOf(t.milestone))).filter(m => !done.has(m)).slice(0, max)
  return list.length ? { ok: true, milestones: list } : { ok: false, reason: 'Every roadmap milestone is merged.' }
}

/** "M1–M3", or "M2" alone. */
export function milestoneRange(ms: string[]): string {
  return ms.length > 1 ? `${ms[0]}–${ms[ms.length - 1]}` : ms[0] ?? ''
}

/** What happens after "Build the MVP", for the confirm dialog. */
export function buildMvpSteps(milestones: string[], v: Pick<IdeaView, 'state'>, policy: IdeaPolicy | null, slot: Pick<BuildSlot, 'running' | 'max'>): string[] {
  const minutes = policy?.build?.mvp?.maxMinutes ?? 240
  const [first, engine, , , ...rest] = buildNowSteps(milestoneRange(milestones), v, policy, slot)
  return [
    first!.replace(`builds ${milestoneRange(milestones)} in`, `builds ${milestones.join(', ')} one after another in`),
    engine!,
    `One run in the sandbox, for up to ${Math.round(minutes / 60)} hours. Each milestone: a gstack plan, tests first, code until they pass. REVENUE.md, if there is one, tells it what must exist before charging.`,
    `It stops at the first milestone whose tests fail${policy?.build?.mvp?.stopOnFallback === false ? '' : ' or that falls back off Opus'}, and opens a PR with what's done. Merging marks the completed milestones done, and the next build starts where it stopped.`,
    'A long Opus run uses a lot of your Claude Pro usage, which your own sessions share.',
    ...rest,
  ]
}

export type GoLiveTarget = { ok: true } | { ok: false; reason: string }

/**
 * Whether "Get it launch-ready" can run: after M1 is merged, with nothing building or waiting for
 * review (idea-factory lib/golive.js goLiveTarget decides when the request runs).
 */
export function goLiveTarget(v: Pick<IdeaView, 'state' | 'buildRequests'>): GoLiveTarget {
  const open = v.buildRequests.find(r => r.status === 'pending' || r.status === 'running')
  if (open) return { ok: false, reason: open.status === 'running' ? 'A build is running now.' : 'A build request is already queued.' }
  const s = v.state
  const b = s.build ?? {}
  if (!s.repo) return { ok: false, reason: 'No repo yet.' }
  if (!(s.milestonesDone ?? []).length) return { ok: false, reason: 'Merge at least M1 first.' }
  if (b.status === 'running') return { ok: false, reason: `${b.milestone ?? 'A build'} is running now.` }
  if (b.status === 'pr-open') return { ok: false, reason: `${b.milestone === 'GOLIVE' ? 'The go-live' : b.milestone ?? 'A'} PR is waiting for your review: merge it first.` }
  return { ok: true }
}

/** What happens after "Get it launch-ready", for the confirm dialog. */
export function goLiveSteps(v: Pick<IdeaView, 'state'>, slot: Pick<BuildSlot, 'running' | 'max'>): string[] {
  const price = v.state.launch?.price
  return [
    slot.running >= slot.max
      ? queuedBehind(slot)
      : 'On its next run (within 15 min) the pipeline makes it launch-ready, in the sandbox, without changing what it does:',
    'SEO basics: titles, meta descriptions, a share image, sitemap.xml, robots.txt and structured data.',
    'Privacy and terms pages, linked from the footer.',
    price ? `A Buy button for ${price} that links to your Stripe payment link (STRIPE_PAYMENT_LINK), hidden until you set it.` : 'No price in a revenue plan yet, so no payment button.',
    'A visit beacon, so real visitors count on this page, and a Vercel project through the credential broker so it deploys.',
    'Opens a "Go live" draft PR with LAUNCH-READY.md (what is left for you). After it merges, the live site is audited every 6 hours on the Road to revenue card.',
  ]
}
