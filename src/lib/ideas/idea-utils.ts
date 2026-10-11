/**
 * The Ideas page's rules, kept pure so they can be tested: which ideas need the owner, what each
 * decision would do next, the demand test's progress and the weekly build slot. The shapes mirror
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
}

export interface IdeaStateJson {
  stage?: IdeaStage
  updatedAt?: string
  review?: { verdict: 'validate' | 'pass'; score: number; summary?: string; at?: string }
  page?: { url: string; deployedAt?: string }
  signals?: { views: number; uniqueVisitors: number; signups: number; updatedAt?: string }
  validation?: { startedAt: string; decideAfter: string; extensions?: number; decision?: 'build' | 'pass' | 'extend'; reason?: string }
  repo?: string
  build?: { milestone?: string; prUrl?: string; status?: string; testsPassing?: boolean; at?: string; reason?: string }
  milestonesDone?: string[]
  revenue?: { mrr: number; updatedAt?: string }
  ownerApproved?: boolean
  passReason?: string
  /** The owner's last decision, set by the pipeline when it applies one (from this page or Notion). */
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

export interface IdeaDocs { research?: string; prd?: string; roadmap?: string; review?: string; launch?: string; build?: string }

export interface IdeaPolicy {
  review?: { minScore?: number; maxPerDay?: number }
  validation?: {
    days?: number; maxValidating?: number; minVisitorsToJudge?: number; maxExtensions?: number
    build?: { minSignups?: number; minSignupRate?: number }
    buildEarly?: { minSignups?: number; minSignupRate?: number }
  }
  build?: { maxPerWeek?: number; engine?: string }
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
  notionUrl: string | null
  updatedAt: Date | null
  /** Live counts from idea_signals (the synced state lags by up to a tick). */
  signals: Signals | null
  /** Newest first. */
  decisions: IdeaDecisionRow[]
}

const DAY = 86_400_000
/** The Notion Idea Board (idea-factory IDEA_BOARD_ID): the board the pipeline follows. */
export const IDEA_BOARD_URL = 'https://www.notion.so/3f5bf9bf93e481b78036fc1cd59fd48f'
/** The idea's git record: idea-factory's ideas/<slug>/. */
export const ideaRecordUrl = (slug: string) => `https://github.com/smithdavedesign/idea-factory/tree/main/ideas/${encodeURIComponent(slug)}`
/** A review the pipeline acted on by itself stays in "needs you" this long, so you can overrule it. */
export const RECENT_REVIEW_DAYS = 14
/** The pipeline ticks every 15 minutes; past this its heartbeat counts as stale. */
export const PIPELINE_STALE_MINUTES = 60

const DEFAULTS = {
  maxPerWeek: 1, maxValidating: 5, days: 14, minVisitorsToJudge: 50,
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

/** The owner has already decided this idea (a decision applied here, or a Pass/Build set in Notion). */
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

/** Which decisions the pipeline can act on from this stage (idea-factory ownerOverride). */
export function checkDecision(v: Pick<IdeaView, 'stage' | 'state' | 'review' | 'notionUrl'>, decision: IdeaDecisionKind): DecisionCheck {
  if (!v.notionUrl) return { ok: false, reason: 'This idea has no Notion row yet, so the pipeline has nowhere to record the decision.' }
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

export interface BuildSlot { used: number; max: number; free: boolean; nextFreeAt: Date | null }

/** policy.build.maxPerWeek over builds started in the last 7 days (idea-factory buildsThisWeek). */
export function buildSlot(views: Pick<IdeaView, 'state'>[], policy: IdeaPolicy | null, now: Date): BuildSlot {
  const max = policy?.build?.maxPerWeek ?? DEFAULTS.maxPerWeek
  const starts = views.map(v => v.state.build?.at).filter((at): at is string => !!at)
    .map(at => new Date(at).getTime()).filter(t => now.getTime() - t < 7 * DAY).sort((a, b) => a - b)
  const free = starts.length < max
  return { used: starts.length, max, free, nextFreeAt: free ? null : new Date(starts[starts.length - max]! + 7 * DAY) }
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
      const when = slot.free
        ? 'Builds M1 right after, on your Claude subscription (the free pool only if it’s out of capacity): tests first, then code until they pass.'
        : `This week’s build slot is used (${slot.used} of ${slot.max}); M1 starts after ${slot.nextFreeAt ? fmtDay(slot.nextFreeAt) : 'the slot frees up'}.`
      return [
        'On its next run (within 15 min) the pipeline sets the Notion row to Build.',
        repo,
        when,
        'Your note, if you add one, goes to the builder with the PRD.',
        'Opens a draft PR (branch m1) for you to merge. Each merged milestone starts the next one in the roadmap.',
        '$0: free hosting tiers only.',
      ]
    }
    case 'validate': {
      const max = policy?.validation?.maxValidating ?? DEFAULTS.maxValidating
      const days = policy?.validation?.days ?? DEFAULTS.days
      return [
        'On its next run the pipeline sets the Notion row to Validate.',
        validating >= max
          ? `${validating} demand tests are already running (the cap is ${max}): its landing page waits for a free slot.`
          : 'Its landing page goes live on the free idea-pages site at the next daily run (09:30), with a launch post to share.',
        `For ${days} days visitors and waitlist signups are counted; the pipeline then builds or passes it by policy.json.`,
      ]
    }
    case 'pass':
      if (v.stage === 'pass') return ['Records that you agree with the review’s pass: the idea leaves “Needs your call”.', 'Nothing else changes. You can still approve it later.']
      return [
        'On its next run the pipeline sets the Notion row to Pass.',
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
