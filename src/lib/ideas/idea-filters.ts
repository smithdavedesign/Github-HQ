/**
 * Sorting and filtering the Ideas page, to decide what to approve and build: by score, by credibility
 * (how strong the review found the demand evidence), by effort or newest, and by the tag groups research
 * picks one tag from (idea-factory SKILL.md "tags"). Pure, so the server page and the client filter bar
 * share it; the filters live in the URL.
 */
import type { IdeaView } from './idea-utils'

export interface TagOption { tag: string; label: string }
export interface TagGroup { key: string; label: string; tags: TagOption[] }

/** Research gives every idea one tag from each group but the last, plus `ai` where it applies. Any other tag is a topic. */
export const TAG_GROUPS: TagGroup[] = [
  { key: 'vibe', label: 'Vibe', tags: [{ tag: 'fun', label: 'Fun' }, { tag: 'wacky', label: 'Wacky' }, { tag: 'serious', label: 'Serious' }] },
  { key: 'for', label: 'For', tags: [{ tag: 'consumer', label: 'Consumers' }, { tag: 'business', label: 'Businesses' }, { tag: 'developers', label: 'Developers' }] },
  { key: 'money', label: 'Money', tags: [{ tag: 'saas', label: 'SaaS' }, { tag: 'one-time', label: 'One-time' }, { tag: 'service', label: 'Service' }] },
  {
    key: 'reach', label: 'First users from', tags: [
      { tag: 'reach:viral', label: 'Spreads itself' }, { tag: 'reach:search', label: 'Search' }, { tag: 'reach:marketplace', label: 'App stores' },
      { tag: 'reach:community', label: 'Community posts' }, { tag: 'reach:outbound', label: 'Cold outreach' },
    ],
  },
  { key: 'tech', label: 'Tech', tags: [{ tag: 'ai', label: 'AI' }] },
]

const GROUP_OF = new Map(TAG_GROUPS.flatMap(g => g.tags.map(t => [t.tag, g.key] as const)))

/** Where the first users come from decided most verdicts: outbound sales is the owner's time, spreading needs none. */
export const TAG_TONE: Record<string, 'good' | 'warn'> = { 'reach:viral': 'good', 'reach:outbound': 'warn' }

export const IDEA_SORTS = [
  { key: 'score', label: 'Score' },
  { key: 'credibility', label: 'Credibility' },
  { key: 'effort', label: 'Effort' },
  { key: 'newest', label: 'Newest' },
] as const
export type IdeaSort = typeof IDEA_SORTS[number]['key']

export const EFFORTS = ['low', 'medium', 'high'] as const

export interface IdeaFilters {
  sort: IdeaSort
  /** Within a group any picked tag matches; every group with a pick must match. */
  tags: string[]
  effort: string[]
  minScore: number | null
  q: string
  /** Only ideas the owner sent (seeded). */
  mine: boolean
}

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(',') : v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export function parseIdeaFilters(sp: Params): IdeaFilters {
  const sort = one(sp.sort)
  const min = Number(one(sp.min))
  return {
    sort: IDEA_SORTS.some(s => s.key === sort) ? sort as IdeaSort : 'score',
    tags: [...new Set(list(sp.tags))].slice(0, 20),
    effort: [...new Set(list(sp.effort))].filter(e => (EFFORTS as readonly string[]).includes(e)),
    minScore: Number.isInteger(min) && min >= 1 && min <= 10 ? min : null,
    q: one(sp.q).slice(0, 100),
    mine: one(sp.mine) === '1',
  }
}

/** The query string for a set of filters, defaults left out: '' when nothing is set. */
export function filtersQuery(f: IdeaFilters): string {
  const p = new URLSearchParams()
  if (f.sort !== 'score') p.set('sort', f.sort)
  if (f.tags.length) p.set('tags', f.tags.join(','))
  if (f.effort.length) p.set('effort', f.effort.join(','))
  if (f.minScore !== null) p.set('min', String(f.minScore))
  if (f.q.trim()) p.set('q', f.q)
  if (f.mine) p.set('mine', '1')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const filtersActive = (f: IdeaFilters) => f.tags.length > 0 || f.effort.length > 0 || f.minScore !== null || f.q.trim() !== '' || f.mine

export const scoreOf = (v: IdeaView): number | null => v.state.review?.score ?? v.review?.score ?? null
const tagsOf = (v: IdeaView) => (v.idea.tags ?? []).map(t => String(t).toLowerCase())

const CONFIDENCE: Record<string, number> = { high: 6, medium: 4, low: 2 }

/**
 * How believable the demand is, 0–10: the review's demand score (its evidence that people want and pay for
 * this), else the research's own confidence (High 6, Medium 4, Low 2) for ideas reviewed before demand was scored.
 */
export function credibilityOf(v: IdeaView): { score: number; label: string } | null {
  const demand = v.review?.forcingQuestions?.demand?.score
  if (typeof demand === 'number') return { score: demand, label: `demand ${demand}/10` }
  const c = v.idea.confidence?.toLowerCase()
  return c && c in CONFIDENCE ? { score: CONFIDENCE[c], label: `confidence ${c}` } : null
}

const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }
const recency = (v: IdeaView) => new Date(v.state.review?.at ?? v.idea.recordedAt ?? v.updatedAt ?? 0).getTime()

export function filterIdeas(views: IdeaView[], f: IdeaFilters): IdeaView[] {
  const picked = new Map<string, Set<string>>()
  for (const t of f.tags) {
    const g = GROUP_OF.get(t) ?? 'topic'
    picked.set(g, (picked.get(g) ?? new Set()).add(t))
  }
  const q = f.q.trim().toLowerCase()
  return views.filter(v => {
    const tags = tagsOf(v)
    for (const group of picked.values()) if (!tags.some(t => group.has(t))) return false
    if (f.effort.length && !f.effort.includes((v.idea.effort ?? '').toLowerCase())) return false
    if (f.minScore !== null && (scoreOf(v) ?? -1) < f.minScore) return false
    if (f.mine && !v.idea.seedId) return false
    if (q && ![v.slug, v.title, v.idea.oneLiner ?? '', ...tags].some(s => s.toLowerCase().includes(q))) return false
    return true
  })
}

export function sortIdeas(views: IdeaView[], sort: IdeaSort): IdeaView[] {
  const score = (v: IdeaView) => scoreOf(v) ?? -1
  const cred = (v: IdeaView) => credibilityOf(v)?.score ?? -1
  const effort = (v: IdeaView) => EFFORT_RANK[(v.idea.effort ?? '').toLowerCase()] ?? 3
  const by: Record<IdeaSort, (a: IdeaView, b: IdeaView) => number> = {
    score: (a, b) => score(b) - score(a) || cred(b) - cred(a) || recency(b) - recency(a),
    credibility: (a, b) => cred(b) - cred(a) || score(b) - score(a) || (b.idea.sources?.length ?? 0) - (a.idea.sources?.length ?? 0),
    effort: (a, b) => effort(a) - effort(b) || score(b) - score(a),
    newest: (a, b) => recency(b) - recency(a),
  }
  return [...views].sort(by[sort])
}

/** How many ideas carry each tag. */
export function tagCounts(views: IdeaView[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of views) for (const t of new Set(tagsOf(v))) out[t] = (out[t] ?? 0) + 1
  return out
}

/** Tags outside the groups, most used first. */
export function topicTags(views: IdeaView[], max = 16): { tag: string; count: number }[] {
  return Object.entries(tagCounts(views))
    .filter(([t]) => !GROUP_OF.has(t))
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, max)
}

/** The group tags on an idea, in group order, for its card. */
export function cardTags(v: IdeaView): TagOption[] {
  const tags = new Set(tagsOf(v))
  return TAG_GROUPS.flatMap(g => g.tags.filter(t => tags.has(t.tag)))
}
