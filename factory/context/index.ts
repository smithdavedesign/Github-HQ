/**
 * One context index for every agent (docs/personal-context.md, "One context layer"): repos (RepoHQ),
 * ideas (idea-factory), bookmarks (Resource Center) and the system docs, each entry tagged with its
 * data class. Pure: building, classifying and searching. Loaders live in sources.ts.
 *
 * Data classes decide who may see an entry:
 *   public    → anyone, any model
 *   personal  → the owner's agents; local models, Claude (subscription or API), the free pool
 *   work      → employer-confidential: local models only, so never returned unless asked for
 *   financial → never ingested at all (dropped at build time)
 */

export type DataClass = 'public' | 'personal' | 'work' | 'financial'
export type Source = 'repo' | 'idea' | 'bookmark' | 'doc'

export interface ContextEntry {
  id: string
  source: Source
  dataClass: DataClass
  title: string
  text: string
  url?: string
  tags: string[]
  updatedAt?: string
}

export interface ContextIndex {
  builtAt: string
  counts: Record<string, number>
  entries: ContextEntry[]
}

/** What a caller sees unless it asks for more. Work data is for local models only. */
export const DEFAULT_CLASSES: DataClass[] = ['public', 'personal']

// ─── Classification ─────────────────────────────────────────────────────────

export const FINANCE_TOPICS = new Set(['Finance & Banking', 'Finance Docs & Property'])
export const WORK_TOPICS = new Set([
  'AI Builder Program', 'Solidigm Design System', 'Work: AEM & Adobe', 'Work: Analytics & Marketing',
  'Work: Docs, Planning & Intranet', 'Work: Platforms & Vendors', 'Work: Repos & Dev', 'Work: Site Audit',
])
/** Employer-internal hosts and repos (same list as the Resource Center Bridge). */
export const INTERNAL_HOST = /\.local$|(^|\.)corp\.|nandps|adobecqms|okta\.com$|sharepoint\.com$|service-now\.com$/i
const INTERNAL_URL = /sldm-innersource/i
const FINANCE_URL = /bankofamerica|americanexpress|chase\.com|wellsfargo|capitalone|fidelity|schwab|vanguard|mortgage|creditunion|paypal\.com\/myaccount|venmo/i

export function classifyBookmark(topic: string, url: string): DataClass {
  let host = ''
  try { host = new URL(url).hostname } catch { /* not a URL */ }
  if (FINANCE_TOPICS.has(topic) || FINANCE_URL.test(url)) return 'financial'
  if (WORK_TOPICS.has(topic) || INTERNAL_HOST.test(host) || INTERNAL_URL.test(url)) return 'work'
  return 'personal'
}

// ─── Building ───────────────────────────────────────────────────────────────

export function buildIndex(entries: ContextEntry[], now = new Date()): ContextIndex {
  const kept = entries.filter(e => e.dataClass !== 'financial')
  const counts: Record<string, number> = {}
  for (const e of kept) counts[`${e.source}:${e.dataClass}`] = (counts[`${e.source}:${e.dataClass}`] ?? 0) + 1
  counts.droppedFinancial = entries.length - kept.length
  return { builtAt: now.toISOString(), counts, entries: kept }
}

// ─── Search: deterministic keyword ranking (BM25-style), no embeddings ─────

const STOP = new Set('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your my me we our'.split(' '))

/** Plural folding only ("expenses" → "expense", "trips" → "trip"); code-ish words like next.js stay as they are. */
const stem = (t: string) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !/[.#+]/.test(t) ? t.slice(0, -1) : t)

export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) ?? [])
    .filter(t => t.length > 1 && !STOP.has(t))
    .map(stem)
}

export interface SearchOptions { classes?: DataClass[]; sources?: Source[]; limit?: number }
export interface SearchHit { entry: ContextEntry; score: number }

export function search(index: ContextIndex, query: string, opts: SearchOptions = {}): SearchHit[] {
  const classes = new Set<DataClass>((opts.classes ?? DEFAULT_CLASSES).filter(c => c !== 'financial'))
  const pool = index.entries.filter(e => classes.has(e.dataClass) && (!opts.sources || opts.sources.includes(e.source)))
  const terms = [...new Set(tokenize(query))]
  if (!terms.length || !pool.length) return []
  const docs = pool.map(e => ({ e, title: tokenize(`${e.title} ${e.tags.join(' ')}`), body: tokenize(e.text) }))
  const avgLen = docs.reduce((n, d) => n + d.body.length, 0) / docs.length || 1
  const df = new Map<string, number>()
  for (const t of terms) df.set(t, docs.filter(d => d.title.includes(t) || d.body.includes(t)).length)
  const k1 = 1.2, b = 0.75
  const hits: SearchHit[] = []
  for (const d of docs) {
    let score = 0
    for (const t of terms) {
      const n = df.get(t)!
      if (!n) continue
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      const tf = d.body.filter(x => x === t).length
      const tfTitle = d.title.filter(x => x === t).length
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.body.length / avgLen)) + 2.5 * Math.min(tfTitle, 2))
    }
    if (score > 0) hits.push({ entry: d.e, score: Math.round(score * 100) / 100 })
  }
  return hits.sort((x, y) => y.score - x.score || x.entry.id.localeCompare(y.entry.id)).slice(0, opts.limit ?? 10)
}

// ─── Summaries for agents ───────────────────────────────────────────────────

/** The owner's interests from bookmarks (personal class only): top topics, then the most recent saves. */
export function interests(index: ContextIndex, recent = 15): { topics: Array<{ topic: string; count: number }>; recent: string[] } {
  const marks = index.entries.filter(e => e.source === 'bookmark' && e.dataClass === 'personal')
  const byTopic = new Map<string, number>()
  for (const m of marks) for (const t of m.tags.slice(0, 1)) byTopic.set(t, (byTopic.get(t) ?? 0) + 1)
  return {
    topics: [...byTopic].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
    recent: [...marks].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, recent).map(m => `${m.title} (${m.tags[0]})`),
  }
}

/** A short plain-text brief of the whole system for an agent starting cold. */
export function overview(index: ContextIndex): string {
  const repos = index.entries.filter(e => e.source === 'repo')
  const ideas = index.entries.filter(e => e.source === 'idea')
  const tag = (e: ContextEntry, prefix: string) => e.tags.find(t => t.startsWith(prefix))?.slice(prefix.length)
  const mrr = repos.reduce((n, r) => n + Number(tag(r, 'mrr:') ?? 0), 0)
  const focus = repos.filter(r => r.tags.includes('focus')).map(r => r.title)
  const stages = new Map<string, number>()
  for (const i of ideas) { const s = tag(i, 'stage:') ?? 'unknown'; stages.set(s, (stages.get(s) ?? 0) + 1) }
  return [
    `Context index built ${index.builtAt}.`,
    `Repos: ${repos.length} (${repos.filter(r => r.dataClass === 'public').length} public). Focus: ${focus.join(', ') || 'none set'}. Total MRR: $${mrr.toFixed(2)}.`,
    `Ideas: ${ideas.length}${stages.size ? ` — ${[...stages].map(([s, n]) => `${n} ${s}`).join(', ')}` : ''}.`,
    `Bookmarks: ${index.entries.filter(e => e.source === 'bookmark').length} indexed (finance never; work for local models only). Docs: ${index.entries.filter(e => e.source === 'doc').length} sections.`,
    'Big picture: RepoHQ docs/system-overview.md.',
  ].join('\n')
}
