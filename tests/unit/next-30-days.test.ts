import { describe, expect, it } from 'vitest'
import { prValueFromLabels, PR_VALUE_LABELS } from '../../src/lib/agents/pr-value'
import { parseGhSearchPrs, prAgeDays, prSource, sortForReview, type OpenPr } from '../../src/lib/agents/open-prs'
import { decide, nextActionLines, nextActions, type RepoSignals } from '../../src/lib/portfolio/next-actions'
import { computeFactoryKpis, kpiHeadline, type JobRecord } from '../../src/lib/agents/factory-kpis'
import { pendingValues, toJobRecords, type AttemptEntry, type LedgerEntry } from '../../factory/lib/ledger'
import { inboxLines } from '../../factory/lib/report'

const NOW = new Date('2026-10-08T15:00:00Z')

describe('PR value labels', () => {
  it('reads value:N, highest wins, ignores everything else', () => {
    expect(prValueFromLabels(['bug', 'value:3'])).toBe(3)
    expect(prValueFromLabels(['Value:1', 'value:4'])).toBe(4)
    expect(prValueFromLabels(['value:0'])).toBe(0)
    expect(prValueFromLabels(['value:6', 'value:x', 'needs-review'])).toBeNull()
  })
  it('defines six labels, value:0 to value:5', () => {
    expect(PR_VALUE_LABELS.map(l => l.name)).toEqual(['value:0', 'value:1', 'value:2', 'value:3', 'value:4', 'value:5'])
  })
})

describe('open PRs', () => {
  const pr = (over: Partial<OpenPr>): OpenPr => ({
    repo: 'me/app', number: 1, title: 't', url: 'https://github.com/me/app/pull/1', author: 'me', createdAt: NOW, isDraft: false, labels: [], ...over,
  })
  it('tells factory, Dependabot, bots, the owner and contributors apart', () => {
    const factoryUrls = new Set(['https://github.com/me/app/pull/9'])
    expect(prSource(pr({ url: 'https://github.com/me/app/pull/9' }), { ownerLogin: 'me', factoryUrls })).toBe('factory')
    expect(prSource(pr({ author: 'app/dependabot' }))).toBe('dependabot')
    expect(prSource(pr({ author: 'dependabot[bot]' }))).toBe('dependabot')
    expect(prSource(pr({ author: 'renovate[bot]' }))).toBe('bot')
    expect(prSource(pr({ author: 'Me' }), { ownerLogin: 'me' })).toBe('owner')
    expect(prSource(pr({ author: 'someone' }), { ownerLogin: 'me' })).toBe('other')
  })
  it('sorts oldest first and counts whole days', () => {
    const old = pr({ url: 'a', createdAt: new Date(NOW.getTime() - 9 * 86_400_000) })
    const fresh = pr({ url: 'b', createdAt: new Date(NOW.getTime() - 3_600_000) })
    expect(sortForReview([fresh, old]).map(p => p.url)).toEqual(['a', 'b'])
    expect(prAgeDays(old, NOW)).toBe(9)
    expect(prAgeDays(fresh, NOW)).toBe(0)
  })
  it('parses gh search output and skips malformed rows', () => {
    const json = JSON.stringify([
      { repository: { nameWithOwner: 'me/app' }, number: 4, title: 'Fix', url: 'https://github.com/me/app/pull/4', author: { login: 'app/dependabot' }, createdAt: '2026-10-01T00:00:00Z', isDraft: true, labels: [{ name: 'value:2' }] },
      { number: 5 },
    ])
    expect(parseGhSearchPrs(json)).toEqual([{
      repo: 'me/app', number: 4, title: 'Fix', url: 'https://github.com/me/app/pull/4', author: 'app/dependabot',
      createdAt: new Date('2026-10-01T00:00:00Z'), isDraft: true, labels: ['value:2'],
    }])
    expect(parseGhSearchPrs('not json')).toEqual([])
  })
})

describe('next actions (decision states)', () => {
  const repo = (over: Partial<RepoSignals>): RepoSignals => ({
    id: 1, name: 'app', fullName: 'me/app', lifecycleStatus: 'maintaining', isFocused: false, isArchived: false, purpose: null, mrr: 0,
    hasProductionUrl: false, healthScore: 60, activityStatus: 'Low Activity', buildStatus: 'success', daysSincePush: 30, openPrs: 0,
    archiveScore: 0, criticalAlerts: 0, highAlerts: 0, factoryManaged: false, ...over,
  })
  it('a valuable repo with red CI or alerts is blocked, and says whether the factory can fix it', () => {
    const d = decide(repo({ isFocused: true, buildStatus: 'failure', factoryManaged: true }))
    expect(d.state).toBe('blocked')
    expect(d.nextAction).toMatch(/factory allowlist, so it can take this/)
    expect(d.reasons).toContain('CI is red on the default branch')
    expect(decide(repo({ mrr: 20, highAlerts: 2 })).nextAction).toMatch(/Patch the 2 alerts.*yours/)
  })
  it('alerts on an unvalued repo do not block it', () => {
    expect(decide(repo({ highAlerts: 3, daysSincePush: 400 })).state).toBe('archive')
  })
  it('focus and building repos are Build; open PRs come first, stalls are called out', () => {
    expect(decide(repo({ isFocused: true, openPrs: 2 })).nextAction).toBe('Review the 2 open PRs first')
    expect(decide(repo({ lifecycleStatus: 'building', daysSincePush: 20 })).nextAction).toMatch(/Stalled/)
    expect(decide(repo({ isFocused: true, daysSincePush: 2 })).reasons).toContain('active this week')
  })
  it('idea → explore, sunsetting → reconsider, idle and unvalued → archive, live → maintain', () => {
    expect(decide(repo({ lifecycleStatus: 'idea' })).state).toBe('explore')
    expect(decide(repo({ lifecycleStatus: 'sunsetting' })).state).toBe('reconsider')
    expect(decide(repo({ archiveScore: 75 })).state).toBe('archive')
    expect(decide(repo({ lifecycleStatus: 'production', hasProductionUrl: true })).state).toBe('maintain')
  })
  it('lists the top few by priority, skips archived repos and counts the rest', () => {
    const n = nextActions([
      repo({ id: 1, name: 'quiet', lifecycleStatus: 'production', hasProductionUrl: true }),
      repo({ id: 2, name: 'broken', isFocused: true, buildStatus: 'failure' }),
      repo({ id: 3, name: 'focus', isFocused: true, openPrs: 1 }),
      repo({ id: 4, name: 'idea', lifecycleStatus: 'idea' }),
      repo({ id: 5, name: 'old', daysSincePush: 500 }),
      repo({ id: 6, name: 'gone', isArchived: true }),
      repo({ id: 7, name: 'sunset', lifecycleStatus: 'sunsetting' }),
    ])
    expect(n.activeRepos).toBe(6)
    expect(n.attention.map(d => d.name)).toEqual(['broken', 'focus', 'sunset'])
    expect(n.archiveSuggestions.map(d => d.name)).toEqual(['old'])
    expect(n.counts).toMatchObject({ blocked: 1, build: 1, explore: 1, reconsider: 1, maintain: 1, archive: 1 })
    const lines = nextActionLines(n)
    expect(lines[0]).toMatch(/6 active repos: 1 blocked · 1 build/)
    expect(lines[1]).toMatch(/^1\. broken — BLOCKED: Fix the red CI/)
    expect(lines.at(-1)).toMatch(/Archive candidates \(1\): old/)
  })
})

describe('PR value in KPIs and the ledger', () => {
  const job = (over: Partial<JobRecord>): JobRecord => ({
    id: 'j', startedAt: new Date(NOW.getTime() - 86_400_000), tier: 'M1', status: 'verified', prUrl: 'u', outcome: 'merged',
    resolvedAt: NOW, humanCommits: 0, requests: null, adversaryModel: null, ...over,
  })
  it('averages rated merged PRs and counts useful ones (value ≥ 2)', () => {
    const k = computeFactoryKpis([job({ value: 4 }), job({ value: 1 }), job({ value: null }), job({ outcome: 'rejected', value: 5 })], NOW)
    expect(k).toMatchObject({ ratedPrs: 2, avgValue: 2.5, usefulPrs: 1, usefulPerNight: 1 })
    expect(kpiHeadline(k)).toMatch(/value 2\.5\/5 over 2 rated/)
    expect(computeFactoryKpis([job({})], NOW)).toMatchObject({ ratedPrs: 0, avgValue: null, usefulPerNight: null })
  })
  const attempt = (id: string, prUrl?: string): AttemptEntry => ({
    type: 'attempt', id, runId: 'r', at: '2026-10-07T03:00:00Z', repo: 'me/app', kind: 'fix-lint', taskTier: 1, tier: 'M0', model: 'm',
    harness: 'aider', outcome: 'verified', reason: '', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, ...(prUrl ? { prUrl } : {}),
  })
  it('pendingValues: merged in the last 30 days and not rated yet', () => {
    const entries: LedgerEntry[] = [
      attempt('a', 'u1'), attempt('b', 'u2'), attempt('c', 'u3'), attempt('d', 'u4'),
      { type: 'resolution', attemptId: 'a', at: '2026-10-07T10:00:00Z', outcome: 'merged' },
      { type: 'resolution', attemptId: 'b', at: '2026-10-07T10:00:00Z', outcome: 'merged' },
      { type: 'resolution', attemptId: 'c', at: '2026-10-07T10:00:00Z', outcome: 'rejected' },
      { type: 'resolution', attemptId: 'd', at: '2026-08-01T10:00:00Z', outcome: 'merged' },
      { type: 'value', attemptId: 'b', at: '2026-10-07T11:00:00Z', value: 3 },
    ]
    expect(pendingValues(entries, NOW).map(a => a.id)).toEqual(['a'])
    expect(toJobRecords(entries).find(j => j.id === 'b')?.value).toBe(3)
  })
})

describe('morning report review queue', () => {
  const att: AttemptEntry = {
    type: 'attempt', id: 'a1', runId: 'r', at: '2026-10-01T03:00:00Z', repo: 'me/app', kind: 'fix-lint', taskTier: 1, tier: 'M1', model: 'm',
    harness: 'claude', outcome: 'verified', reason: '', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0,
    prUrl: 'https://github.com/me/app/pull/7', adversary: { model: 'x', verdict: 'UNCERTAIN', issues: 1 },
  }
  const prs: OpenPr[] = [
    { repo: 'me/app', number: 8, title: 'Bump next', url: 'https://github.com/me/app/pull/8', author: 'app/dependabot', createdAt: new Date('2026-10-07T00:00:00Z'), isDraft: false, labels: [] },
    { repo: 'me/app', number: 7, title: 'fix lint', url: 'https://github.com/me/app/pull/7', author: 'me', createdAt: new Date('2026-10-01T03:00:00Z'), isDraft: true, labels: [] },
  ]
  it('lists every open PR oldest first, flags aging ones and annotates factory PRs', () => {
    const lines = inboxLines(prs, [att], new Map([['a1', { type: 'review', attemptId: 'a1', at: '', reviewer: 'copilot', comments: 0, highlights: [] }]]), NOW, 'me')
    expect(lines[0]).toMatch(/^2 open PRs, 1 open 7\+ days/)
    expect(lines[1]).toBe('⚠ app#7 · 7d · factory · fix lint errors (M1) [reviewer: UNCERTAIN, review clean, draft, repo paused for new factory PRs until this is merged or closed] — https://github.com/me/app/pull/7')
    expect(lines[2]).toMatch(/^app#8 · 1d · Dependabot · Bump next — /)
  })
  it('says so when the search failed or the queue is empty', () => {
    expect(inboxLines(null, [], new Map(), NOW)[0]).toMatch(/Could not list/)
    expect(inboxLines([], [], new Map(), NOW)).toEqual(['No open PRs anywhere. Inbox zero.'])
  })
})
