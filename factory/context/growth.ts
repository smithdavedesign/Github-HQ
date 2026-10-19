/**
 * The growth loop's owner side (docs/growth-loop-prd.md): the morning email's Today block (at most five
 * things for the owner, about ten minutes, money first) and the Growth section for the focus products.
 * Pure apart from readGrowthInput, which the report calls to gather idea-factory's files.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { OpenPr } from '../../src/lib/agents/open-prs'
import { GROWTH_STAGE_LABEL, IDEAS_PAGE_URL, beaconLive, experimentLine, featureWeek, funnelSummary, launchKitOrder, nextMissionText, planItemStatus } from '../../src/lib/ideas/idea-utils'
import type { IdeaState } from './ideas'
import { readLaunchLog, type LaunchLog } from './idea-pipeline'

export interface GrowthInput {
  /** policy.growth.focus: the products the loop works on, most important first. */
  focus: string[]
  /** policy.growth.minVisitorsPerWeek: the traction bar. */
  minVisitorsPerWeek: number
  /** policy.build.startNew false: ideas never built wait until a focus product reaches the bar. */
  holdNewBuilds: boolean
  /** policy.autonomy.merge: the pipeline merges its own green PRs, so only the ones it left are the owner's. */
  autonomy?: boolean
  /** LAUNCH-KIT.md, per idea that has one (focus products and demand tests). */
  kits: Record<string, string>
  /** launch-log.json, per idea that has one. */
  logs: Record<string, LaunchLog>
}

/** The Today block's cap: about ten minutes of the owner's morning. */
export const TODAY_MAX = 5
const DAY = 86_400_000
const short = (t: string) => t.split(' — ')[0]!.slice(0, 40)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** What the report needs from idea-factory: policy.json's growth settings, launch kits and launch logs. */
export function readGrowthInput(ideaHome: string, ideas: IdeaState[]): GrowthInput {
  let policy: { growth?: { focus?: unknown; minVisitorsPerWeek?: unknown }; build?: { startNew?: unknown }; autonomy?: { merge?: unknown } } = {}
  try { policy = JSON.parse(readFileSync(path.join(ideaHome, 'policy.json'), 'utf8')) } catch { /* no policy: no focus */ }
  const rawFocus = policy.growth?.focus
  const focus = Array.isArray(rawFocus) ? rawFocus.filter((s): s is string => typeof s === 'string') : []
  const bar = policy.growth?.minVisitorsPerWeek
  const kits: Record<string, string> = {}
  const logs: Record<string, LaunchLog> = {}
  for (const i of ideas.filter(x => focus.includes(x.slug) || x.stage === 'validate')) {
    const kit = path.join(ideaHome, 'ideas', i.slug, 'LAUNCH-KIT.md')
    if (existsSync(kit)) kits[i.slug] = readFileSync(kit, 'utf8')
    const log = readLaunchLog(ideaHome, i.slug)
    if (log) logs[i.slug] = log
  }
  return { focus, minVisitorsPerWeek: typeof bar === 'number' ? bar : 50, holdNewBuilds: policy.build?.startNew === false, autonomy: policy.autonomy?.merge === true, kits, logs }
}

/**
 * A launch kit's channels in posting order, from its "## Order" list (the launch skill's format): the
 * bold name ("1. **r/SideProject**, Tue …"), else the text before the first comma, colon or bracket.
 */
export function kitChannels(kit: string | undefined): string[] {
  const order = launchKitOrder(kit)
  if (!order) return []
  return order.split('\n').map(l => /^\s*\d+\.\s+(.*)$/.exec(l)?.[1]).filter((l): l is string => !!l)
    .map(l => (/\*\*(.+?)\*\*/.exec(l)?.[1] ?? l.split(/[,:(]/)[0]!).trim()).filter(Boolean)
}

/** Whether a logged post went to this kit channel: the names differ a little ("BiggerPockets" for "BiggerPockets source thread"). */
function samePlace(channel: string, logged: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?reddit\.com/, '').replace(/[^a-z0-9/]+/g, '')
  const a = norm(channel), b = norm(logged)
  return !!a && !!b && (a.includes(b) || b.includes(a))
}

/**
 * The next kit channel with no logged post, or null: every channel is posted, or this idea had a post in
 * the last day (the kit spaces posts so the source of each spike stays readable).
 */
export function nextPost(kit: string | undefined, log: LaunchLog | undefined, now: Date): { channel: string; index: number; total: number } | null {
  const channels = kitChannels(kit)
  const posts = log?.posts ?? []
  if (!channels.length || posts.some(p => now.getTime() - new Date(p.postedAt).getTime() < DAY)) return null
  const i = channels.findIndex(c => !posts.some(p => samePlace(c, p.channel)))
  return i < 0 ? null : { channel: channels[i]!, index: i + 1, total: channels.length }
}

/** Checklist steps that are things to do. Posting has its own line; the first user and dollar are outcomes. */
const ACTION_STEPS = new Set(['price', 'payments'])

/**
 * The Today block: what the growth loop needs from the owner this morning, money first, at most TODAY_MAX
 * lines. Focus products' checklist steps, then the next post from a launch kit (focus products, then demand
 * tests, which are judged on visitors), then PRs on idea repos waiting for a merge. With autonomy on, the
 * pipeline merges its own green PRs: only the ones it left for the owner are listed, with why.
 */
export function todayLines(ideas: IdeaState[], g: GrowthInput, openPrs: OpenPr[] | null | undefined, now: Date): string[] {
  const bySlug = new Map(ideas.map(i => [i.slug, i]))
  const focus = g.focus.map(s => bySlug.get(s)).filter((i): i is IdeaState => !!i)
  const items: string[] = []
  for (const i of focus) {
    const next = i.launch?.next
    if (next?.owner === 'david' && ACTION_STEPS.has(next.id)) items.push(`${short(i.title)}, your step on the road to revenue: ${next.label} (${IDEAS_PAGE_URL}/${i.slug})`)
    // The loop stops building on a product whose experiments keep moving nothing: whether to park it is yours.
    if (i.growth?.next?.kind === 'park') items.push(`${short(i.title)}: ${i.growth.bottleneck ?? 'its experiments moved nothing'}. Park it or keep going? (${IDEAS_PAGE_URL}/${i.slug})`)
  }
  // Demand tests closest to their decision first: a test short of visitors at its deadline is extended, then parked.
  const tests = ideas.filter(x => x.stage === 'validate' && !g.focus.includes(x.slug))
    .sort((a, b) => (a.validation?.decideAfter ?? '9999').localeCompare(b.validation?.decideAfter ?? '9999'))
  for (const i of [...focus, ...tests]) {
    if (!g.kits[i.slug]) { items.push(`${short(i.title)} has no launch kit yet: run /launch ${i.slug} for posts ready to paste`); continue }
    const p = nextPost(g.kits[i.slug], g.logs[i.slug], now)
    if (p) items.push(`Post ${short(i.title)} to ${p.channel} (${p.index} of ${p.total} in its launch kit, written and ready), then log it with /launch ${i.slug} posted`)
  }
  const repos = new Map(ideas.filter(i => i.repo).map(i => [i.repo!.replace('https://github.com/', '').toLowerCase(), i]))
  const prs = (openPrs ?? []).filter(p => repos.has(p.repo.toLowerCase())).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const p of prs) {
    const i = repos.get(p.repo.toLowerCase())!
    const mine = i.build?.prUrl === p.url
    if (g.autonomy && mine && !i.build?.held) continue // merges itself once its checks pass
    items.push(`Merge or close ${short(i.title)}#${p.number} (${p.title})${mine && i.build?.held ? `, left for you: ${i.build.held}` : ''}: ${p.url}`)
  }
  if (!items.length) return ['Nothing for you in the growth loop today.']
  return [...items.slice(0, TODAY_MAX), ...(items.length > TODAY_MAX ? [`…and ${items.length - TODAY_MAX} more: ${IDEAS_PAGE_URL}`] : [])]
}

/**
 * The Growth section: the focus and the traction bar (and the new-build hold it lifts), then per focus
 * product its funnel this week, where visitors came from, launch-kit channels posted and its road to revenue.
 */
export function growthLines(ideas: IdeaState[], g: GrowthInput): string[] {
  const bySlug = new Map(ideas.map(i => [i.slug, i]))
  const focus = g.focus.map(s => bySlug.get(s)).filter((i): i is IdeaState => !!i)
  if (!focus.length) return []
  const traction = focus.some(i => (i.funnel?.d7?.visit ?? 0) >= g.minVisitorsPerWeek)
  const hold = !g.holdNewBuilds ? '' : traction ? ' Reached, so new MVP builds can start again.' : ' Until one reaches it, ideas never built wait for their first build.'
  const lines = [`Focus: ${focus.map(i => short(i.title)).join(', ')}. Traction bar: ${g.minVisitorsPerWeek} visitors a week.${hold}`]
  // The feature loop (idea-factory lib/plan.js): what was built from the weekly plans, and what moved.
  const fw = featureWeek(focus.map(i => ({ name: short(i.title), growth: i.growth })))
  if (fw.built || fw.merged || fw.judged.length || focus.some(i => i.growth?.plan)) {
    lines.push(`Features, last 7 days: ${fw.built} built, ${fw.merged} merged${fw.judged.length ? `; judged: ${fw.judged.join('; ')}` : ''}. They build at night (22:00–07:00), one per product at a time.`)
  }
  for (const i of focus) {
    const name = short(i.title)
    const f = i.funnel
    const sources = f?.referrers7d?.length ? `; sources: ${f.referrers7d.map(r => `${r.host} ${r.visitors}`).join(', ')}` : ''
    lines.push(`${name}: ${f ? `${funnelSummary(f)}${sources}` : 'no funnel yet (the pipeline saves one once the product is deployed or has a visitor)'}.`)
    if (f && !beaconLive(i)) lines.push(`${name} still runs the old beacon (one view from the home page), so activations and Buy clicks aren't counted yet; its next growth build adds them.`)
    const gr = i.growth
    if (gr?.stage) {
      lines.push(`Growth loop: ${GROWTH_STAGE_LABEL[gr.stage].toLowerCase()} (${gr.bottleneck ?? ''}). Next: ${nextMissionText(gr.next)}.`)
      for (const e of (gr.experiments ?? []).filter(x => x.status === 'proposed' || x.status === 'running' || x.status === 'measuring')) {
        lines.push(`Experiment: ${experimentLine(e)}${e.prUrl ? ` — ${e.prUrl}` : ''}`)
      }
      if (gr.plan?.items?.length) {
        const items = gr.plan.items.map((it, k) => `${k + 1}. ${it.title} (${planItemStatus(it, gr.experiments)}${it.payments ? ', payments: yours to merge' : ''})`)
        lines.push(`Plan, week of ${gr.plan.at.slice(0, 10)}: ${items.join('; ')}.`)
      } else if (gr.planFailedAt) {
        lines.push(`Plan: the weekly plan failed on ${gr.planFailedAt.slice(0, 10)}; it's tried again tonight.`)
      }
    }
    const channels = kitChannels(g.kits[i.slug])
    const posts = g.logs[i.slug]?.posts ?? []
    const last = posts.map(p => p.postedAt).sort().at(-1)
    lines.push(channels.length ? `Distribution: ${posts.length} of ${plural(channels.length, 'kit channel')} posted${last ? `, the last on ${last.slice(0, 10)}` : ''}.` : 'Distribution: no launch kit yet.')
    if (i.launch?.total) lines.push(`Road to revenue: ${i.launch.done}/${i.launch.total}${i.launch.next ? `, next: ${i.launch.next.label} (${i.launch.next.owner === 'david' ? 'yours' : 'agents'})` : ', every step done'}.`)
  }
  return lines
}
