import { describe, it, expect } from 'vitest'
import {
  cardTags, credibilityOf, filterIdeas, filtersActive, filtersQuery, parseIdeaFilters, sortIdeas, tagCounts, topicTags, type IdeaFilters,
} from '../../src/lib/ideas/idea-filters'
import type { IdeaView } from '../../src/lib/ideas/idea-utils'

function idea(slug: string, over: { tags?: string[]; score?: number; demand?: number; confidence?: string; effort?: string; at?: string; seedId?: string; oneLiner?: string } = {}): IdeaView {
  return {
    slug, title: `${slug} — a tool for someone`, stage: 'idea',
    idea: { oneLiner: over.oneLiner ?? 'one liner', tags: over.tags, confidence: over.confidence, effort: over.effort, seedId: over.seedId, recordedAt: over.at },
    state: over.score === undefined ? {} : { review: { verdict: 'pass', score: over.score, at: over.at } },
    review: over.demand === undefined ? null : { forcingQuestions: { demand: { score: over.demand, evidence: 'threads' } } },
    docs: {}, notionUrl: null, updatedAt: null, signals: null, decisions: [], buildRequests: [],
  }
}
const NONE: IdeaFilters = parseIdeaFilters({})
const slugs = (vs: IdeaView[]) => vs.map(v => v.slug)

describe('Ideas page filters: the URL', () => {
  it('reads defaults, ignores junk, and keeps only known sorts and efforts', () => {
    expect(NONE).toEqual({ sort: 'score', tags: [], effort: [], minScore: null, q: '', mine: false })
    expect(parseIdeaFilters({ sort: 'hype', min: '11', effort: 'tiny,LOW', tags: ' Fun ,reach:viral,fun', mine: '1', q: 'pets' }))
      .toEqual({ sort: 'score', tags: ['fun', 'reach:viral'], effort: ['low'], minScore: null, q: 'pets', mine: true })
    expect(parseIdeaFilters({ sort: 'credibility', min: '6', tags: ['ai', 'saas'] })).toMatchObject({ sort: 'credibility', minScore: 6, tags: ['ai', 'saas'] })
  })

  it('writes only what differs from the defaults, and reads back the same filters', () => {
    expect(filtersQuery(NONE)).toBe('')
    const f: IdeaFilters = { sort: 'effort', tags: ['fun', 'reach:viral'], effort: ['low', 'medium'], minScore: 6, q: 'pet gifts', mine: true }
    expect(parseIdeaFilters(Object.fromEntries(new URLSearchParams(filtersQuery(f))))).toEqual(f)
    expect(filtersActive(NONE)).toBe(false)
    expect(filtersActive({ ...NONE, sort: 'newest' })).toBe(false)
    expect(filtersActive({ ...NONE, q: '  ' })).toBe(false)
    expect(filtersActive({ ...NONE, minScore: 5 })).toBe(true)
  })
})

describe('Ideas page filters: which ideas show', () => {
  const views = [
    idea('court', { tags: ['fun', 'consumer', 'one-time', 'reach:viral', 'ai', 'social'], score: 7, effort: 'Low', seedId: 'seed-1' }),
    idea('pets', { tags: ['wacky', 'consumer', 'one-time', 'reach:community', 'pets'], score: 5, effort: 'Medium', oneLiner: 'Your pet as a crime boss' }),
    idea('audit', { tags: ['serious', 'business', 'service', 'reach:outbound'], score: 4, effort: 'High' }),
    idea('untagged'),
  ]

  it('any picked tag within a group matches; every group with a pick must match', () => {
    expect(slugs(filterIdeas(views, { ...NONE, tags: ['fun', 'wacky'] }))).toEqual(['court', 'pets'])
    expect(slugs(filterIdeas(views, { ...NONE, tags: ['fun', 'wacky', 'reach:community'] }))).toEqual(['pets'])
    expect(slugs(filterIdeas(views, { ...NONE, tags: ['pets', 'social'] }))).toEqual(['court', 'pets'])
    expect(slugs(filterIdeas(views, { ...NONE, tags: ['ai', 'reach:outbound'] }))).toEqual([])
  })

  it('filters by effort, minimum score, owner-sent and text', () => {
    expect(slugs(filterIdeas(views, { ...NONE, effort: ['low', 'high'] }))).toEqual(['court', 'audit'])
    expect(slugs(filterIdeas(views, { ...NONE, minScore: 5 }))).toEqual(['court', 'pets'])
    expect(slugs(filterIdeas(views, { ...NONE, mine: true }))).toEqual(['court'])
    expect(slugs(filterIdeas(views, { ...NONE, q: ' CRIME ' }))).toEqual(['pets'])
    expect(slugs(filterIdeas(views, { ...NONE, q: 'outbound' }))).toEqual(['audit'])
    expect(filterIdeas(views, NONE)).toHaveLength(4)
  })
})

describe('Ideas page filters: order and credibility', () => {
  it('credibility is the review demand score, else the research confidence', () => {
    expect(credibilityOf(idea('a', { demand: 3, confidence: 'High' }))).toEqual({ score: 3, label: 'demand 3/10' })
    expect(credibilityOf(idea('b', { confidence: 'Medium' }))).toEqual({ score: 4, label: 'confidence medium' })
    expect(credibilityOf(idea('c'))).toBeNull()
  })

  const views = [
    idea('mid', { score: 5, demand: 6, effort: 'Medium', at: '2026-10-10T00:00:00Z' }),
    idea('top', { score: 8, demand: 2, effort: 'High', at: '2026-10-01T00:00:00Z' }),
    idea('none', { effort: 'Low', at: '2026-10-12T00:00:00Z' }),
    idea('tie', { score: 5, confidence: 'Low', at: '2026-10-11T00:00:00Z' }),
  ]

  it('sorts by score, credibility, effort or newest, with missing values last', () => {
    expect(slugs(sortIdeas(views, 'score'))).toEqual(['top', 'mid', 'tie', 'none'])
    expect(slugs(sortIdeas(views, 'credibility'))).toEqual(['mid', 'top', 'tie', 'none'])
    expect(slugs(sortIdeas(views, 'effort'))).toEqual(['none', 'mid', 'top', 'tie'])
    expect(slugs(sortIdeas(views, 'newest'))).toEqual(['none', 'tie', 'mid', 'top'])
    expect(slugs(views)).toEqual(['mid', 'top', 'none', 'tie'])
  })
})

describe('Ideas page filters: tags', () => {
  const views = [
    idea('a', { tags: ['fun', 'reach:viral', 'ai', 'pets', 'social'] }),
    idea('b', { tags: ['serious', 'social', 'Social'] }),
  ]

  it('counts tags once per idea and lists topics outside the groups, most used first', () => {
    expect(tagCounts(views)).toEqual({ fun: 1, 'reach:viral': 1, ai: 1, pets: 1, social: 2, serious: 1 })
    expect(topicTags(views)).toEqual([{ tag: 'social', count: 2 }, { tag: 'pets', count: 1 }])
  })

  it('a card shows its group tags in group order, labelled', () => {
    expect(cardTags(idea('c', { tags: ['ai', 'pets', 'reach:outbound', 'fun'] })).map(t => t.label)).toEqual(['Fun', 'Cold outreach', 'AI'])
  })
})
