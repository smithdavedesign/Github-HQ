import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildIndex, classifyBookmark, interests, overview, search, tokenize, type ContextEntry } from '../../factory/context/index'
import { loadDocs, loadIdeas, parseBookmarks } from '../../factory/context/sources'

const entry = (id: string, over: Partial<ContextEntry> = {}): ContextEntry => ({ id, source: 'repo', dataClass: 'public', title: id, text: '', tags: [], ...over })

describe('data classes', () => {
  it('finance is financial, employer topics and internal hosts are work, the rest personal', () => {
    expect(classifyBookmark('Finance & Banking', 'https://example.com')).toBe('financial')
    expect(classifyBookmark('Learning & Career Growth', 'https://www.bankofamerica.com/login')).toBe('financial')
    expect(classifyBookmark('AI Builder Program', 'https://github.com/x')).toBe('work')
    expect(classifyBookmark('Unsorted', 'https://npsg-jira.elements.local/browse/EAI-1')).toBe('work')
    expect(classifyBookmark('Unsorted', 'https://firebird.usm-cpr-nprd.corp.nandps.com/')).toBe('work')
    expect(classifyBookmark('Unsorted', 'https://github.com/sldm-innersource/spm-app')).toBe('work')
    expect(classifyBookmark('AI Tools', 'https://anthropic.com')).toBe('personal')
  })
  it('financial entries are never indexed', () => {
    const idx = buildIndex([entry('a'), entry('b', { dataClass: 'financial' }), entry('c', { dataClass: 'work' })])
    expect(idx.entries.map(e => e.id)).toEqual(['a', 'c'])
    expect(idx.counts.droppedFinancial).toBe(1)
  })
})

describe('search', () => {
  const idx = buildIndex([
    entry('repo:open-travel', { title: 'Open-Travel', text: 'Travel planning app with trip budgets and expenses', dataClass: 'public' }),
    entry('idea:tripsplit', { source: 'idea', title: 'Tripsplit', text: 'Offline group expense splitter for trips', dataClass: 'personal' }),
    entry('bookmark:1', { source: 'bookmark', title: '[EAI-1] Travel tool - Jira', text: 'internal travel jira', dataClass: 'work' }),
    entry('doc:x', { source: 'doc', title: 'Unrelated', text: 'nothing about it at all', dataClass: 'public' }),
  ])
  it('ranks title matches first and never returns work data by default', () => {
    const hits = search(idx, 'travel expenses')
    expect(hits.map(h => h.entry.id)).toEqual(['repo:open-travel', 'idea:tripsplit'])
    expect(hits.some(h => h.entry.dataClass === 'work')).toBe(false)
  })
  it('work data only when asked for (local models), financial never', () => {
    expect(search(idx, 'travel', { classes: ['public', 'personal', 'work'] }).some(h => h.entry.id === 'bookmark:1')).toBe(true)
    expect(search(idx, 'travel', { classes: ['financial'] })).toEqual([])
  })
  it('filters by source and limit; empty or stop-word queries return nothing', () => {
    expect(search(idx, 'trip', { sources: ['idea'] }).map(h => h.entry.id)).toEqual(['idea:tripsplit'])
    expect(search(idx, 'travel', { limit: 1 })).toHaveLength(1)
    expect(search(idx, 'the and of')).toEqual([])
  })
  it('tokenizes code-ish words and drops stop words', () => {
    expect(tokenize('The Next.js app, c# and C++ — is it fast?')).toEqual(['next.js', 'app', 'c#', 'c++', 'fast'])
  })
})

describe('sources', () => {
  it('parses Resource Center data.js/meta.js with cleaned titles and dates', () => {
    const data = 'window.BM={"topics":["AI Tools","Finance & Banking"],"items":[[0,"raw","https://a.com/x","Bar",0],[1,"Bank","https://bank.com","Money",1]]};'
    const meta = 'window.META={"days":[20000,20001],"titles":{"0":"Clean title"}};'
    const [a, b] = parseBookmarks(data, meta)
    expect(a).toMatchObject({ id: 'bookmark:0', title: 'Clean title', dataClass: 'personal', tags: ['AI Tools'], updatedAt: new Date(20000 * 86_400_000).toISOString() })
    expect(b!.dataClass).toBe('financial')
  })
  it('loads idea records with their PRD sections and lifecycle stage', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ideas-'))
    const dir = path.join(home, 'ideas', 'tripsplit')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'idea.json'), JSON.stringify({ title: 'Tripsplit', oneLiner: 'Split trip costs offline', tags: ['travel'] }))
    writeFileSync(path.join(dir, 'PRD.md'), '# PRD\n## Problem\nRoaming kills apps.\n## Target user\nTrip organizers.\n## MVP scope\n- x')
    writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ stage: 'validate', review: { verdict: 'validate', score: 7, summary: 'clear pain' } }))
    const { entries } = loadIdeas(home)
    expect(entries[0]).toMatchObject({ id: 'idea:tripsplit', dataClass: 'personal', tags: ['stage:validate', 'travel'] })
    expect(entries[0]!.text).toMatch(/Roaming kills apps\..*Trip organizers\..*Review: validate \(7\/10\)/)
  })
  it('splits docs into sections so agents find the exact part', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'docs-'))
    mkdirSync(path.join(root, 'docs'))
    writeFileSync(path.join(root, 'README.md'), '# RepoHQ\nA portfolio dashboard for many repos and agents.\n## Setup\nRun npm install and set the env vars listed below.')
    writeFileSync(path.join(root, 'docs', 'x.md'), '# X\n## Tiny\nshort')
    const titles = loadDocs(root).entries.map(e => e.title)
    expect(titles).toEqual(['RepoHQ', 'RepoHQ — Setup'])
  })
})

describe('agent summaries', () => {
  const idx = buildIndex([
    entry('repo:a', { title: 'a', tags: ['focus', 'mrr:4.99'] }),
    entry('idea:x', { source: 'idea', tags: ['stage:validate'] }),
    entry('bookmark:1', { source: 'bookmark', dataClass: 'personal', title: 'Course', tags: ['Learning'], updatedAt: '2026-10-01' }),
    entry('bookmark:2', { source: 'bookmark', dataClass: 'work', title: 'Jira', tags: ['AI Builder Program'] }),
  ])
  it('interests come from personal bookmarks only', () => {
    expect(interests(idx)).toEqual({ topics: [{ topic: 'Learning', count: 1 }], recent: ['Course (Learning)'] })
  })
  it('the overview names focus repos, revenue and the idea pipeline', () => {
    const o = overview(idx)
    expect(o).toMatch(/Focus: a\. Total MRR: \$4\.99\./)
    expect(o).toMatch(/Ideas: 1 — 1 validate\./)
  })
})

describe('idea lifecycle in the morning report', async () => {
  const { ideaLines, readIdeaStates } = await import('../../factory/context/ideas')
  const now = new Date('2026-10-10T12:00:00Z')
  it('summarises stages, demand while validating, builds and revenue', () => {
    const lines = ideaLines([
      { slug: 'a', title: 'Alpha — x', stage: 'idea' },
      { slug: 'b', title: 'Beta — y', stage: 'validate', page: { url: 'https://p/b' }, signals: { views: 40, uniqueVisitors: 31, signups: 1 }, validation: { startedAt: '2026-10-01', decideAfter: '2026-10-15T12:00:00Z' } },
      { slug: 'c', title: 'Gamma', stage: 'building', build: { prUrl: 'https://github.com/o/c/pull/1', status: 'pr-open', testsPassing: false } },
      { slug: 'd', title: 'Delta', stage: 'live', revenue: { mrr: 12.5 } },
      { slug: 'e', title: 'Eps', stage: 'pass', updatedAt: '2026-10-10T08:00:00Z', validation: { startedAt: '', decideAfter: '', decision: 'pass', reason: '0 signups from 120 visitors' } },
    ], now)
    expect(lines[0]).toBe('Pipeline: 1 awaiting review · 1 validating · 1 building · 1 live · 1 passed. Idea MRR: $12.50.')
    expect(lines).toContain('Validating Beta: 31 visitors, 1 signup, decision in 5d — https://p/b')
    expect(lines).toContain('Building Gamma: M1 PR pr-open (tests failing) — https://github.com/o/c/pull/1')
    expect(lines).toContain('Live Delta: $12.50 MRR')
    expect(lines).toContain('Passed Eps: 0 signups from 120 visitors')
    expect(ideaLines([], now)).toEqual([])
  })
  it('reads ideas/<slug>/state.json, defaulting to stage "idea"', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ideas-'))
    for (const [slug, state] of [['one', { stage: 'validate' }], ['two', null]] as const) {
      mkdirSync(path.join(home, 'ideas', slug), { recursive: true })
      writeFileSync(path.join(home, 'ideas', slug, 'idea.json'), JSON.stringify({ title: slug.toUpperCase() }))
      if (state) writeFileSync(path.join(home, 'ideas', slug, 'state.json'), JSON.stringify(state))
    }
    expect(readIdeaStates(home).map(i => [i.slug, i.title, i.stage]).sort()).toEqual([['one', 'ONE', 'validate'], ['two', 'TWO', 'idea']])
  })
})
