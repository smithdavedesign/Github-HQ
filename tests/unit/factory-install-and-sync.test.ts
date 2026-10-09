import { describe, expect, it } from 'vitest'
import { installCommand, withoutScripts } from '../../factory/lib/checks'
import { rankOpportunities } from '../../factory/lib/sensors'
import { systemHealthLines } from '../../factory/lib/system-health'
import { syncFailure } from '../../src/lib/health/sync-health'
import type { LedgerEntry, SignalsEntry } from '../../factory/lib/ledger'

const NOW = new Date('2026-10-09T13:00:00Z')

describe('install without scripts', () => {
  it('adds --ignore-scripts to the same install', () => {
    expect(withoutScripts(installCommand('npm', new Set(['package-lock.json'])))).toEqual({ cmd: 'npm', args: ['ci', '--no-audit', '--no-fund', '--ignore-scripts'] })
    expect(withoutScripts(installCommand('pnpm', new Set()))).toEqual({ cmd: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] })
  })
})

describe('a repo whose install failed sits out for a day', () => {
  const sig = (repo: string, critical: number): SignalsEntry => ({
    type: 'signals', runId: 'r', at: NOW.toISOString(), repo, base: 'main', redCi: [],
    alerts: { status: 'ok', critical, high: 0, medium: 0, low: 0, npmFixable: critical }, botPrs: { open: 0, stale: [] },
  })
  const failedScan = (at: string): LedgerEntry => ({ type: 'scan', runId: 'r', at, repo: 'o/broken', checks: { install: false }, tasks: [] })
  it('drops below repos with work it can do, then comes back after 24 h', () => {
    const signals = [sig('o/broken', 5), sig('o/fine', 1)]
    expect(rankOpportunities(['o/broken', 'o/fine'], [failedScan('2026-10-09T10:00:00Z')], signals, NOW)[0].repo).toBe('o/fine')
    expect(rankOpportunities(['o/broken', 'o/fine'], [failedScan('2026-10-08T10:00:00Z')], signals, NOW)[0].repo).toBe('o/broken')
  })
})

describe('sync failure check', () => {
  const run = (status: string, startedAt: string, error: string | null = null) => ({ status, startedAt, error })
  it('counts consecutive failed syncs back from the newest finished one', () => {
    const f = syncFailure([run('running', '2026-10-09T12:00:00Z'), run('failed', '2026-10-09T06:00:00Z', 'Bad credentials'), run('failed', '2026-10-09T00:00:00Z', 'Bad credentials'), run('complete', '2026-10-08T18:00:00Z')])
    expect(f).toMatchObject({ failures: 2, since: '2026-10-09T00:00:00Z', error: 'Bad credentials' })
    expect(f!.hint).toMatch(/sign out of RepoHQ and sign back in/)
    expect(syncFailure([run('complete', '2026-10-09T06:00:00Z'), run('failed', '2026-10-09T00:00:00Z')])).toBeNull()
  })
  it('raises the alarm in the morning report', () => {
    const h = systemHealthLines({ disabledWorkflows: [], latestSnapshot: '2026-10-09', requests: null, syncs: [run('failed', '2026-10-09T06:00:00Z', 'Bad credentials - https://docs.github.com/rest')] }, NOW)
    expect(h.alarm).toBe(true)
    expect(h.lines.some(l => /⚠ RepoHQ sync: the last sync failed .*sign back in/.test(l))).toBe(true)
  })
})
