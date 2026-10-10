/**
 * The idea pipeline's per-idea lifecycle record, as stored by idea-factory in ideas/<slug>/state.json
 * (docs/idea-factory.md). RepoHQ reads it for the morning report and the context index; idea-factory
 * writes it. Keep the two in step.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

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
  build?: { prUrl?: string; status?: 'pr-open' | 'merged' | 'failed'; testsPassing?: boolean; at?: string }
  revenue?: { mrr: number; updatedAt?: string }
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

/** Morning report lines: where each idea is, its demand signal, and revenue from built ones. */
export function ideaLines(ideas: IdeaState[], now: Date): string[] {
  if (!ideas.length) return []
  const by = (s: IdeaStage) => ideas.filter(i => i.stage === s)
  const mrr = ideas.reduce((n, i) => n + (i.revenue?.mrr ?? 0), 0)
  const days = (iso?: string) => (iso ? Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000) : null)
  return [
    `Pipeline: ${by('idea').length} awaiting review · ${by('validate').length} validating · ${by('build').length + by('repo').length + by('building').length} building · ${by('live').length} live · ${by('pass').length} passed. Idea MRR: $${mrr.toFixed(2)}.`,
    ...by('validate').map(i => {
      const s = i.signals ?? { views: 0, uniqueVisitors: 0, signups: 0 }
      const left = days(i.validation?.decideAfter)
      return `Validating ${short(i.title)}: ${s.uniqueVisitors} visitors, ${s.signups} signup${s.signups === 1 ? '' : 's'}${left !== null ? `, decision in ${Math.max(left, 0)}d` : ''}${i.page ? ` — ${i.page.url}` : ''}`
    }),
    ...[...by('building'), ...by('repo')].map(i => `Building ${short(i.title)}: ${i.build?.prUrl ? `M1 PR ${i.build.status ?? 'open'}${i.build.testsPassing === false ? ' (tests failing)' : ''} — ${i.build.prUrl}` : 'repo created, M1 not started'}`),
    ...by('live').map(i => `Live ${short(i.title)}: $${(i.revenue?.mrr ?? 0).toFixed(2)} MRR`),
    ...ideas.filter(i => i.stage === 'pass' && i.validation?.decision === 'pass' && i.updatedAt && now.getTime() - new Date(i.updatedAt).getTime() < 86_400_000)
      .map(i => `Passed ${short(i.title)}: ${i.validation?.reason ?? 'no demand signal'}`),
  ]
}
