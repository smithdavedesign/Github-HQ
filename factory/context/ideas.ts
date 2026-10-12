/**
 * The idea pipeline's per-idea lifecycle record, as stored by idea-factory in ideas/<slug>/state.json
 * (docs/idea-factory.md). RepoHQ reads it for the morning report and the context index; idea-factory
 * writes it. Keep the two in step.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { IDEAS_PAGE_URL, needsDecision, type IdeaStateJson } from '../../src/lib/ideas/idea-utils'

export type IdeaStage = 'idea' | 'validate' | 'build' | 'repo' | 'building' | 'live' | 'pass'

export interface IdeaState {
  slug: string
  title: string
  stage: IdeaStage
  updatedAt?: string
  review?: { verdict: 'validate' | 'pass'; score: number; summary?: string; at?: string }
  page?: { url: string; deployedAt?: string }
  signals?: { views: number; uniqueVisitors: number; signups: number; updatedAt?: string }
  validation?: { startedAt: string; decideAfter: string; decision?: 'build' | 'pass' | 'extend'; reason?: string }
  repo?: string
  build?: { milestone?: string; prUrl?: string; status?: 'pr-open' | 'merged' | 'failed' | 'running'; testsPassing?: boolean; at?: string }
  /** An M1 built on the Mac but never pushed (e.g. a `--no-push` builder test). */
  localM1?: { path: string; branch: string; testsPassing?: boolean; note?: string }
  revenue?: { mrr: number; updatedAt?: string }
  ownerApproved?: boolean
  passReason?: string
  ownerDecision?: IdeaStateJson['ownerDecision']
  /** The road to the first dollar (idea-factory lib/revenue.js). */
  launch?: IdeaStateJson['launch']
}

export function readIdeaStates(ideaHome: string): IdeaState[] {
  const dir = path.join(ideaHome, 'ideas')
  if (!existsSync(dir)) return []
  const out: IdeaState[] = []
  for (const slug of readdirSync(dir)) {
    try {
      const idea = JSON.parse(readFileSync(path.join(dir, slug, 'idea.json'), 'utf8'))
      const stateFile = path.join(dir, slug, 'state.json')
      const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
      out.push({ stage: 'idea', ...state, slug, title: idea.title ?? slug })
    } catch { /* skip malformed */ }
  }
  return out
}

const short = (t: string) => t.split(' — ')[0]!.slice(0, 40)

/** Where a repo-stage idea's build stands, without claiming "not started" for an M1 that exists locally. */
export function buildStatus(i: IdeaState): string {
  if (i.build?.prUrl) return `M1 PR ${i.build.status ?? 'open'}${i.build.testsPassing === false ? ' (tests failing)' : ''} — ${i.build.prUrl}`
  if (i.localM1) return `M1 built locally on branch ${i.localM1.branch}${i.localM1.testsPassing === false ? ' (tests failing)' : ''}, not pushed${i.localM1.note ? ` (${i.localM1.note})` : ''}`
  return 'repo created, M1 not started'
}

/** Morning report lines: where each idea is, its demand signal, and revenue from built ones. */
export function ideaLines(ideas: IdeaState[], now: Date): string[] {
  if (!ideas.length) return []
  const by = (s: IdeaStage) => ideas.filter(i => i.stage === s)
  const mrr = ideas.reduce((n, i) => n + (i.revenue?.mrr ?? 0), 0)
  const days = (iso?: string) => (iso ? Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000) : null)
  const waiting = ideas.filter(i => needsDecision({ stage: i.stage, state: i as IdeaStateJson, decisions: [] }, now)).length
  return [
    ...(waiting ? [`${waiting} idea${waiting === 1 ? ' needs' : 's need'} your call: approve, demand-test or pass on the Ideas page — ${IDEAS_PAGE_URL}`] : []),
    `Pipeline: ${by('idea').length} awaiting review · ${by('validate').length} validating · ${by('build').length + by('repo').length + by('building').length} building · ${by('live').length} live · ${by('pass').length} passed. Idea MRR: $${mrr.toFixed(2)}.`,
    ...by('validate').map(i => {
      const s = i.signals ?? { views: 0, uniqueVisitors: 0, signups: 0 }
      const left = days(i.validation?.decideAfter)
      return `Validating ${short(i.title)}: ${s.uniqueVisitors} visitors, ${s.signups} signup${s.signups === 1 ? '' : 's'}${left !== null ? `, decision in ${Math.max(left, 0)}d` : ''}${i.page ? ` — ${i.page.url}` : ''}`
    }),
    ...[...by('building'), ...by('repo')].map(i => `Building ${short(i.title)}: ${buildStatus(i)}`),
    ...by('live').map(i => `Live ${short(i.title)}: $${(i.revenue?.mrr ?? 0).toFixed(2)} MRR`),
    // The road to revenue: closest to the first dollar first, your steps called out.
    ...ideas.filter(i => i.stage !== 'pass' && i.launch?.next).sort((a, b) => (b.launch!.done / b.launch!.total) - (a.launch!.done / a.launch!.total)).slice(0, 5)
      .map(i => `Road to revenue · ${short(i.title)}: ${i.launch!.done}/${i.launch!.total}${i.launch!.price ? ` at ${i.launch!.price}` : ''}, next: ${i.launch!.next!.label} (${i.launch!.next!.owner === 'david' ? 'yours' : 'agents'})`),
    ...ideas.filter(i => i.stage === 'pass' && i.validation?.decision === 'pass' && i.updatedAt && now.getTime() - new Date(i.updatedAt).getTime() < 86_400_000)
      .map(i => `Passed ${short(i.title)}: ${i.validation?.reason ?? 'no demand signal'}`),
  ]
}
