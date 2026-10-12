/**
 * The idea pipeline's live state for agents (MCP tool `get_idea_pipeline`): each idea's stage, its
 * demand test against the decision rules in idea-factory `policy.json`, where visitors came from,
 * and which launch posts went out (`ideas/<slug>/launch-log.json`, written by the `launch` skill).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { GROWTH_STAGE_LABEL, beaconLive, experimentLine, funnelSummary, growthKindLabel, nextMissionText } from '../../src/lib/ideas/idea-utils'
import type { IdeaState } from './ideas'

export interface ValidationPolicy {
  days: number
  minVisitorsToJudge: number
  build: { minSignups: number; minSignupRate: number }
  buildEarly?: { minSignups: number; minSignupRate: number }
}

/** Unique visitors per referring host, from `idea_signals` views and product visits (signups carry no referrer). */
export interface ReferrerCount { slug: string; host: string; visitors: number }

export interface LaunchPost { channel: string; url?: string; postUrl?: string; postedAt: string; note?: string }
export interface LaunchLog { posts: LaunchPost[] }

const readJson = <T>(file: string): T | null => {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return null }
}

export function readValidationPolicy(ideaHome: string): ValidationPolicy | null {
  return readJson<{ validation?: ValidationPolicy }>(path.join(ideaHome, 'policy.json'))?.validation ?? null
}

export function readLaunchLog(ideaHome: string, slug: string): LaunchLog | null {
  const log = readJson<LaunchLog>(path.join(ideaHome, 'ideas', slug, 'launch-log.json'))
  return log && Array.isArray(log.posts) ? log : null
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '?')

/** Where a validating idea stands against the decision rules, in one line. Pure. */
export function demandVerdict(i: IdeaState, policy: ValidationPolicy | null, now: Date): string {
  const s = i.signals ?? { views: 0, uniqueVisitors: 0, signups: 0 }
  const rate = s.uniqueVisitors ? s.signups / s.uniqueVisitors : 0
  const left = i.validation?.decideAfter ? Math.ceil((new Date(i.validation.decideAfter).getTime() - now.getTime()) / 86_400_000) : null
  const head = `${plural(s.uniqueVisitors, 'visitor')}, ${plural(s.signups, 'signup')} (${pct(rate)})${left !== null ? `, decision ${left > 0 ? `in ${left}d (${day(i.validation?.decideAfter)})` : 'due now'}` : ''}`
  if (!policy) return head
  const b = policy.build
  const needVisitors = Math.max(policy.minVisitorsToJudge - s.uniqueVisitors, 0)
  const onTrack = s.signups >= b.minSignups && rate >= b.minSignupRate
  const rule = needVisitors
    ? `needs ${plural(needVisitors, 'more visitor')} before it can be judged (min ${policy.minVisitorsToJudge}); short of that at the deadline it's extended, then parked`
    : onTrack ? `meets the build bar (≥${b.minSignups} signups at ≥${pct(b.minSignupRate)})`
    : `below the build bar (≥${b.minSignups} signups at ≥${pct(b.minSignupRate)})`
  return `${head}. ${rule}.`
}

export interface PipelineInput {
  ideas: IdeaState[]
  policy: ValidationPolicy | null
  referrers: ReferrerCount[]
  launchLogs: Map<string, LaunchLog>
  ideaHome: string
  now: Date
}

const STAGE_ORDER = ['validate', 'building', 'repo', 'build', 'live', 'idea', 'pass'] as const

/** All ideas by stage, with validating ones in detail. Pure. */
/** A build's name: a milestone, the whole MVP, the go-live or a growth change (idea-factory's "MVP", "GOLIVE", "GROWTH"). */
const buildName = (m?: string, kind?: string) => (m === 'GOLIVE' ? 'Go-live' : m === 'GROWTH' ? `Growth build (${growthKindLabel(kind ?? 'one change')})` : m ?? 'M1')

export function formatPipeline(p: PipelineInput): string {
  const by = new Map<string, IdeaState[]>()
  for (const i of p.ideas) by.set(i.stage, [...(by.get(i.stage) ?? []), i])
  const mrr = p.ideas.reduce((n, i) => n + (i.revenue?.mrr ?? 0), 0)
  const lines = [`# Idea pipeline (${p.ideas.length} ideas, idea MRR $${mrr.toFixed(2)})`]
  for (const stage of STAGE_ORDER) {
    const list = by.get(stage)
    if (!list?.length) continue
    lines.push(`\n## ${stage} (${list.length})`)
    for (const i of list) {
      if (stage === 'validate') {
        const posts = p.launchLogs.get(i.slug)?.posts.length ?? 0
        lines.push(`- **${i.slug}**: ${demandVerdict(i, p.policy, p.now)} Launch posts logged: ${posts}.${i.page ? ` ${i.page.url}` : ''}`)
      } else if (stage === 'pass') {
        lines.push(`- ${i.slug}: ${i.validation?.reason ?? (i.review?.summary ? clip(i.review.summary, 160) : undefined) ?? 'passed'}`)
      } else {
        const extra = i.build?.prUrl ? ` ${buildName(i.build.milestone, i.build.kind)} PR ${i.build.status ?? 'open'}: ${i.build.prUrl}` : i.revenue ? ` $${i.revenue.mrr.toFixed(2)} MRR` : i.review ? ` review ${i.review.score}/10` : ''
        const road = i.launch?.total ? ` Road to revenue ${i.launch.done}/${i.launch.total}${i.launch.next ? `, next: ${i.launch.next.label} (${i.launch.next.owner === 'david' ? 'yours' : 'agents'})` : ', done'}.` : ''
        const funnel = i.funnel ? ` Funnel: ${funnelSummary(i.funnel)}.` : ''
        const growth = i.growth?.stage ? ` Growth: ${GROWTH_STAGE_LABEL[i.growth.stage].toLowerCase()}, next: ${nextMissionText(i.growth.next)}.` : ''
        lines.push(`- ${i.slug}: ${i.title.split(' — ')[0]}.${extra}${road}${funnel}${growth}`)
      }
    }
  }
  lines.push('\nCall again with `slug` for one idea in detail.')
  return lines.join('\n')
}

/** One idea in detail: review, demand test, visitors by source, launch posts. Pure. */
export function formatIdea(i: IdeaState, p: PipelineInput): string {
  const lines = [`# ${i.title} (${i.slug})`, `Stage: ${i.stage}${i.updatedAt ? `, updated ${day(i.updatedAt)}` : ''}`]
  if (i.review) lines.push(`Review: ${i.review.verdict}, ${i.review.score}/10. ${i.review.summary ?? ''}`)
  if (i.page) lines.push(`Page: ${i.page.url}`)
  if (i.validation) lines.push(`Demand test: ${demandVerdict(i, p.policy, p.now)}${i.validation.decision ? ` Decision: ${i.validation.decision}${i.validation.reason ? `, ${i.validation.reason}` : ''}.` : ''}`)
  const refs = p.referrers.filter(r => r.slug === i.slug).sort((a, b) => b.visitors - a.visitors)
  if (refs.length) lines.push(`Visitors by source: ${refs.map(r => `${r.host} ${r.visitors}`).join(', ')}`)
  const posts = p.launchLogs.get(i.slug)?.posts ?? []
  lines.push(posts.length
    ? `Launch posts:\n${posts.map(x => `- ${day(x.postedAt)} ${x.channel}${x.postUrl ? `: ${x.postUrl}` : ''}${x.note ? ` (${x.note})` : ''}`).join('\n')}`
    : i.stage === 'validate' ? 'Launch posts: none logged yet. The `launch` skill drafts them from LAUNCH.md.' : 'Launch posts: none logged.')
  if (i.build) lines.push(`Build: ${buildName(i.build.milestone, i.build.kind)} ${i.build.status ?? '?'}${i.build.prUrl ? ` ${i.build.prUrl}` : ''}${i.build.testsPassing === false ? ' (tests failing)' : ''}`)
  // A built product's funnel (idea-factory lib/growth.js): this week against the last, and its sources.
  if (i.funnel) {
    const f = i.funnel
    lines.push(`Funnel: ${funnelSummary(f)}${f.referrers7d?.length ? `; this week's sources: ${f.referrers7d.map(r => `${r.host} ${r.visitors}`).join(', ')}` : ''}.${beaconLive(i) ? '' : ' It still runs the old beacon (one view from the home page): activations and Buy clicks aren\'t counted yet.'}`)
  }
  // The growth loop on a focus product (idea-factory step 5d): what it sees, what's next, its experiments.
  if (i.growth?.stage) {
    lines.push(`Growth: ${GROWTH_STAGE_LABEL[i.growth.stage]}: ${i.growth.bottleneck ?? ''}. Next: ${nextMissionText(i.growth.next)}.`)
    for (const e of [...(i.growth.experiments ?? [])].reverse().slice(0, 6)) lines.push(`- Experiment ${e.id}: ${experimentLine(e)}${e.prUrl ? ` ${e.prUrl}` : ''}. ${e.hypothesis}`)
  }
  // The road to the first dollar (idea-factory lib/revenue.js), with whose step is next.
  if (i.launch?.total) {
    lines.push(`Road to revenue: ${i.launch.done}/${i.launch.total} steps${i.launch.price ? ` at ${i.launch.price}` : ''}${i.launch.buyer ? `; who pays: ${i.launch.buyer}` : ''}`)
    lines.push(i.launch.next ? `Next: ${i.launch.next.label} (${i.launch.next.owner === 'david' ? 'yours' : 'the agents\''})` : 'Every step is done.')
    for (const s of i.launch.steps) lines.push(`- [${s.done ? 'x' : ' '}] ${s.label}${s.evidence ? ` (${s.evidence})` : ''}`)
  }
  if (i.revenue) lines.push(`Revenue: $${i.revenue.mrr.toFixed(2)} MRR`)
  lines.push(`Full record: ${path.join(p.ideaHome, 'ideas', i.slug)}/`)
  return lines.join('\n')
}
