/**
 * Loaders for the context index (index.ts). Each returns ContextEntry[] and never throws: a source
 * that can't be read is reported in `errors` and the index is built from the rest.
 *
 * Paths avoid ~/Documents: the index is built by the factory worker under launchd, which macOS
 * privacy rules keep out of ~/Documents. Bookmarks therefore come from the resource-center repo on
 * GitHub, ideas from ~/idea-factory, docs from this checkout.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import * as schema from '../../src/lib/db/schema'
import { healthScores, sinkDb } from '../lib/sink'
import { run } from '../lib/proc'
import type { FactoryConfig } from '../lib/config'
import { classifyBookmark, type ContextEntry } from './index'

export interface LoadResult { entries: ContextEntry[]; errors: string[] }

const clip = (s: unknown, n = 1500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** Repos from RepoHQ: what each is, its lifecycle, health and revenue. */
export async function loadRepos(cfg: FactoryConfig): Promise<LoadResult> {
  const d = sinkDb(cfg)
  if (!d || !cfg.repohq.userId) return { entries: [], errors: ['repos: no database URL or FACTORY_USER_ID'] }
  try {
    const rows = await d.query.repositories.findMany({ where: eq(schema.repositories.userId, cfg.repohq.userId) })
    const health = await healthScores(cfg).catch(() => new Map<string, number>())
    return {
      errors: [],
      entries: rows.filter(r => !r.isArchived).map(r => {
        const summary = (r.aiSummary as { what_it_does?: string } | null)?.what_it_does
        const h = health.get(r.fullName.toLowerCase())
        return {
          id: `repo:${r.fullName}`,
          source: 'repo' as const,
          dataClass: r.visibility === 'public' ? 'public' as const : 'personal' as const,
          title: r.name,
          text: clip([r.description, summary, r.purpose && `Purpose: ${r.purpose}`, `Lifecycle: ${r.lifecycleStatus}`,
            r.homepage && `Live: ${r.homepage}`, h !== undefined && `Health ${h}/100`, Number(r.mrr) > 0 && `MRR $${r.mrr}`].filter(Boolean).join('. ')),
          url: `https://github.com/${r.fullName}`,
          tags: [`lifecycle:${r.lifecycleStatus}`, ...(r.isFocused ? ['focus'] : []), `mrr:${Number(r.mrr ?? 0)}`, ...(r.tags ?? []), ...(r.language ? [r.language] : [])],
          updatedAt: r.updatedAt?.toISOString?.(),
        }
      }),
    }
  } catch (e) {
    return { entries: [], errors: [`repos: ${(e as Error).message.slice(0, 200)}`] }
  }
}

/** Ideas from the idea-factory record: one-liner, problem, user, review verdict, lifecycle stage. */
export function loadIdeas(ideaHome: string): LoadResult {
  const dir = path.join(ideaHome, 'ideas')
  if (!existsSync(dir)) return { entries: [], errors: [`ideas: ${dir} not found`] }
  const read = (slug: string, f: string) => { const p = path.join(dir, slug, f); return existsSync(p) ? readFileSync(p, 'utf8') : '' }
  const section = (md: string, name: RegExp) => {
    const m = md.split(/^## /m).find(s => name.test(s.split('\n')[0] ?? ''))
    return m ? m.split('\n').slice(1).join(' ') : ''
  }
  const entries: ContextEntry[] = []
  for (const slug of readdirSync(dir).filter(s => existsSync(path.join(dir, s, 'idea.json')))) {
    try {
      const idea = JSON.parse(read(slug, 'idea.json'))
      const state = read(slug, 'state.json') ? JSON.parse(read(slug, 'state.json')) : {}
      const prd = read(slug, 'PRD.md')
      entries.push({
        id: `idea:${slug}`, source: 'idea', dataClass: 'personal', title: clip(idea.title, 200),
        text: clip([idea.oneLiner, section(prd, /problem/i), section(prd, /user/i), idea.overlaps && `Closest existing: ${idea.overlaps}`,
          state.review?.verdict && `Review: ${state.review.verdict} (${state.review.score}/10) — ${state.review.summary ?? ''}`].filter(Boolean).join(' ')),
        url: `https://github.com/smithdavedesign/idea-factory/tree/main/ideas/${slug}`,
        tags: [`stage:${state.stage ?? 'idea'}`, ...(idea.tags ?? [])],
        updatedAt: state.updatedAt ?? idea.recordedAt,
      })
    } catch (e) {
      // A malformed record is skipped, not fatal.
    }
  }
  return { entries, errors: [] }
}

/** Bookmarks from the Resource Center repo (site/data.js + meta.js). Finance is classified and dropped by buildIndex. */
export async function loadBookmarks(repo = 'smithdavedesign/resource-center'): Promise<LoadResult> {
  const fetchFile = async (p: string) => {
    const r = await run('gh', ['api', `repos/${repo}/contents/${p}`, '--jq', '.content'], { timeoutMs: 60_000, maxOutput: 5_000_000 })
    if (r.code !== 0) throw new Error(`${p}: ${r.output.slice(0, 120)}`)
    return Buffer.from(r.output.replace(/\s+/g, ''), 'base64').toString('utf8')
  }
  try {
    const [data, meta] = await Promise.all([fetchFile('site/data.js'), fetchFile('site/meta.js')])
    return { errors: [], entries: parseBookmarks(data, meta) }
  } catch (e) {
    return { entries: [], errors: [`bookmarks: ${(e as Error).message.slice(0, 200)}`] }
  }
}

/** Pure parser for the Resource Center's `window.BM = {...}` / `window.META = {...}` files. */
export function parseBookmarks(dataJs: string, metaJs: string): ContextEntry[] {
  const json = (js: string) => JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1))
  const bm = json(dataJs) as { topics: string[]; items: Array<[number, string, string, string, number?]> }
  const meta = json(metaJs) as { days?: number[]; titles?: Record<string, string> }
  return bm.items.map(([topicIdx, rawTitle, url, folder], i) => {
    const topic = bm.topics[topicIdx] ?? 'Unsorted'
    const title = meta.titles?.[String(i)] ?? rawTitle ?? url
    const day = meta.days?.[i]
    let host = ''
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep empty */ }
    return {
      id: `bookmark:${i}`, source: 'bookmark' as const, dataClass: classifyBookmark(topic, url),
      title: clip(title, 200), text: clip(`${title} ${host} ${folder ?? ''}`, 400), url,
      tags: [topic], updatedAt: day ? new Date(day * 86_400_000).toISOString() : undefined,
    }
  })
}

/** RepoHQ docs, one entry per `## ` section: the system explains itself to agents. */
export function loadDocs(repoRoot: string): LoadResult {
  const files = [path.join(repoRoot, 'README.md'), ...['docs', 'docs/ai-stack'].flatMap(d => {
    const dir = path.join(repoRoot, d)
    return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)) : []
  })].filter(f => existsSync(f) && statSync(f).size < 400_000 && !/roadmap-history|audit-20/.test(f))
  const entries: ContextEntry[] = []
  for (const f of files) {
    const rel = path.relative(repoRoot, f)
    const md = readFileSync(f, 'utf8')
    const parts = md.split(/^## /m)
    const docTitle = (parts[0]!.match(/^# (.+)$/m)?.[1] ?? rel).trim()
    parts.forEach((p, i) => {
      const heading = i === 0 ? docTitle : p.split('\n')[0]!.trim()
      const body = i === 0 ? p : p.split('\n').slice(1).join('\n')
      if (body.trim().length < 40) return
      entries.push({
        id: `doc:${rel}#${i}`, source: 'doc', dataClass: 'public', title: i === 0 ? docTitle : `${docTitle} — ${heading}`,
        text: clip(body, 2500), url: `https://github.com/smithdavedesign/Github-HQ/blob/main/${rel}`, tags: [rel],
      })
    })
  }
  return { entries, errors: [] }
}
