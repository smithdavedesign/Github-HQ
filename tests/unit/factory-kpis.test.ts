import { describe, expect, it } from 'vitest'
import { computeFactoryKpis, factoryNight, jobRecordFromRow, kpiHeadline, type JobRecord } from '../../src/lib/agents/factory-kpis'
import { toJobRecords, toAttemptRecords, type AttemptEntry, type LedgerEntry } from '../../factory/lib/ledger'
import { agentJobValues } from '../../factory/lib/sink'
import { aiderRequests, parseClaudeResult } from '../../factory/lib/harness'
import { splitStatements } from '../../factory/bin/migrate'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const now = new Date('2026-10-20T13:00:00Z')
const job = (over: Partial<JobRecord>): JobRecord => ({
  id: Math.random().toString(36).slice(2), startedAt: new Date('2026-10-19T04:00:00Z'), tier: 'M0', status: 'verified',
  prUrl: null, outcome: null, resolvedAt: null, humanCommits: null, requests: null, adversaryModel: null, ...over,
})

describe('computeFactoryKpis', () => {
  const nightA = new Date('2026-10-18T04:00:00Z')
  const nightB = new Date('2026-10-19T04:00:00Z')
  const jobs = [
    job({ startedAt: nightA, prUrl: 'p1', outcome: 'merged', resolvedAt: new Date('2026-10-18T16:00:00Z'), humanCommits: 0, tier: 'M1', requests: 20, adversaryModel: 'local-qwen3' }),
    job({ startedAt: nightA, prUrl: 'p2', outcome: 'rejected', resolvedAt: new Date('2026-10-18T10:00:00Z'), tier: 'M1', requests: 10 }),
    job({ startedAt: nightB, prUrl: 'p3', outcome: 'merged', resolvedAt: new Date('2026-10-19T20:00:00Z'), humanCommits: 2, tier: 'M0', requests: 3, adversaryModel: 'free-agent' }),
    job({ startedAt: nightB, prUrl: 'p4' }),
    job({ startedAt: nightB, status: 'failed', tier: 'M1', requests: 15 }),
    job({ startedAt: nightB, status: 'rate_limited', tier: 'M1', requests: 99 }),
    job({ startedAt: new Date('2026-08-01T04:00:00Z'), prUrl: 'old', outcome: 'merged' }),
  ]
  const k = computeFactoryKpis(jobs, now, { approvalsNeeded: 1 })

  it('measures overnight yield as merged PRs per night the factory ran', () => {
    expect(k).toMatchObject({ nights: 2, prsOpened: 4, merged: 2, closed: 1, overnightYield: 1, lastNightPrs: 2 })
  })
  it('acceptance, review time and human edits', () => {
    expect(k.acceptance).toBeCloseTo(2 / 3)
    expect(k.reviewHoursMedian).toBe(12)
    expect(k.humanEditedPrs).toBe(1)
  })
  it('counts free-cloud requests (M1 builds + free-agent reviews), never rate-limited or local ones', () => {
    expect(k.freeRequests).toBe(20 + 10 + 1 + 15)
    expect(k.acceptedPer100FreeRequests).toBeCloseTo((2 / 46) * 100)
  })
  it('autonomy = merged untouched ÷ (resolved + approvals needed)', () => {
    expect(k.autonomy).toBeCloseTo(1 / 4)
  })
  it('is empty-safe', () => {
    expect(computeFactoryKpis([], now)).toMatchObject({ nights: 0, overnightYield: null, acceptance: null, autonomy: null, acceptedPer100FreeRequests: null })
    expect(kpiHeadline(computeFactoryKpis([], now))).toMatch(/no nights yet/)
  })
  it('a factory night runs 07:00–07:00', () => {
    expect(factoryNight(new Date(2026, 9, 20, 3, 0))).toBe('2026-10-19')
    expect(factoryNight(new Date(2026, 9, 20, 8, 0))).toBe('2026-10-20')
  })
  it('maps agent_jobs rows', () => {
    expect(jobRecordFromRow({ id: 'x', startedAt: now, tier: 'M1', status: 'weird', prUrl: null, outcome: 'merged', resolvedAt: null, humanCommits: 0, requests: 4, adversaryModel: null }))
      .toMatchObject({ status: 'failed', outcome: 'merged', requests: 4 })
  })
})

describe('ledger → jobs and routing records', () => {
  const att = (over: Partial<AttemptEntry>): AttemptEntry => ({
    type: 'attempt', id: 'a', runId: 'r', at: '2026-10-19T04:00:00Z', repo: 'o/app', kind: 'fix-types', taskTier: 2, tier: 'M1',
    model: 'free-agent', harness: 'claude-code', outcome: 'verified', reason: 'ok', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 1, outputTokens: 2, ...over,
  })
  it('joins resolutions and keeps requests', () => {
    const entries: LedgerEntry[] = [att({ prUrl: 'p', requests: 12 }), { type: 'resolution', attemptId: 'a', at: '2026-10-19T10:00:00Z', outcome: 'merged', humanCommits: 1 }]
    expect(toJobRecords(entries)[0]).toMatchObject({ outcome: 'merged', humanCommits: 1, requests: 12, prUrl: 'p' })
  })
  it('routing ignores deterministic fixes and investigations', () => {
    const entries: LedgerEntry[] = [
      att({ id: '1', harness: 'npm-audit-fix', tier: 'M0' }), att({ id: '2', harness: 'lint-autofix', tier: 'M0' }),
      att({ id: '3', kind: 'red-ci', findings: '## Root cause', reported: true }), att({ id: '4' }),
    ]
    expect(toAttemptRecords(entries).length).toBe(1)
  })
  it('builds an agent_jobs row with pipeline, parent and reviewer', () => {
    const row = agentJobValues(att({ parentId: 'p0', requests: 9, adversary: { model: 'local-qwen3', verdict: 'PASS', issues: 0 }, isolation: 'docker' }), 'u1', 5)
    expect(row).toMatchObject({ id: 'a', userId: 'u1', repoId: 5, parentJobId: 'p0', requests: 9, adversaryModel: 'local-qwen3', isolation: 'docker', status: 'verified' })
    expect(row.pipeline).toMatch(/typecheck/)
    expect(row.startedAt).toEqual(new Date('2026-10-19T04:00:00Z'))
  })
})

describe('request counting', () => {
  it('Claude Code: num_turns', () => {
    expect(parseClaudeResult('{"type":"result","is_error":false,"result":"ok","num_turns":14,"usage":{}}')?.turns).toBe(14)
  })
  it('Aider: one Tokens line per round trip', () => {
    expect(aiderRequests('Tokens: 2.1k sent, 300 received.\n...\nTokens: 2.5k sent, 120 received.')).toBe(2)
    expect(aiderRequests('no model output')).toBe(0)
  })
})

describe('factory:migrate', () => {
  it('splits SQL keeping DO $$ blocks whole', () => {
    const stmts = splitStatements(readFileSync(path.resolve(__dirname, '../../factory/sql/0001_agent_jobs.sql'), 'utf8'))
    expect(stmts).toHaveLength(4)
    expect(stmts[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "agent_jobs"/)
    expect(stmts[1]).toMatch(/^DO \$\$[\s\S]*END \$\$;$/)
    expect(stmts[3]).toMatch(/^CREATE INDEX IF NOT EXISTS/)
    expect(stmts.every(s => /IF NOT EXISTS/.test(s))).toBe(true)
  })
})
