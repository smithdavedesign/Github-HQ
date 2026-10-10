import { describe, it, expect } from 'vitest'
import { compareSmoke, normalizeError, pendingSmokes, smokeComment, type PageResult, type SmokeEntry } from '../../factory/lib/smoke'
import type { LedgerEntry } from '../../factory/lib/ledger'
import { smokeLines } from '../../factory/lib/report'

const page = (path: string, over: Partial<PageResult> = {}): PageResult => ({ url: `https://x${path}`, path, status: 200, consoleErrors: [], pageErrors: [], ...over })

describe('preview smoke comparison', () => {
  it('passes when the preview behaves like production', () => {
    const prod = [[page('/'), page('/login')], [page('/'), page('/login')]]
    expect(compareSmoke(prod, prod)).toEqual({ verdict: 'pass', reasons: [] })
  })
  it('fails on a status or crash regression, even on one preview load', () => {
    const prod = [[page('/')], [page('/')]]
    const r = compareSmoke(prod, [[page('/', { status: 500 })], [page('/')]])
    expect(r.verdict).toBe('fail')
    expect(r.reasons[0]).toMatch(/\/: HTTP 500 on the preview \(production: HTTP 200\)/)
    expect(compareSmoke(prod, [[page('/', { status: null, error: 'net::ERR_ABORTED' })], [page('/')]]).reasons[0]).toMatch(/ERR_ABORTED/)
  })
  it('a page already broken on production is not the PR\'s fault', () => {
    expect(compareSmoke([[page('/', { status: 404 })]], [[page('/', { status: 404 })]]).verdict).toBe('pass')
  })
  it('fails on a reproducible error the preview has and production does not (the hydration-error class)', () => {
    const hydration = 'Uncaught Error: Minified React error #418; visit https://react.dev/errors/418 for the full message'
    const r = compareSmoke([[page('/')], [page('/')]], [[page('/', { pageErrors: [hydration] })], [page('/', { pageErrors: [hydration] })]])
    expect(r.verdict).toBe('fail')
    expect(r.reasons[0]).toMatch(/page error on the preview only — Uncaught Error: Minified React error #418/)
  })
  it('ignores flaky errors (not on every preview load), third-party noise, and errors production also has', () => {
    const flaky = compareSmoke([[page('/')], [page('/')]], [[page('/', { consoleErrors: ['TypeError: x is undefined'] })], [page('/')]])
    expect(flaky.verdict).toBe('pass')
    const noise = '[GSI_LOGGER]: FedCM get() rejects with NetworkError: Error retrieving a token.'
    expect(compareSmoke([[page('/')]], [[page('/', { consoleErrors: [noise] })], [page('/', { consoleErrors: [noise] })]]).verdict).toBe('pass')
    const known = 'Failed to load resource: the server responded with a status of 403 ()'
    expect(compareSmoke([[page('/', { consoleErrors: [known] })]], [[page('/', { consoleErrors: [known] })], [page('/', { consoleErrors: [known] })]]).verdict).toBe('pass')
  })
  it('production noise that differs only by ids, numbers or URLs still matches', () => {
    expect(normalizeError('Chunk 4fb84c1e9a failed at https://a.vercel.app/x.js line 12')).toBe(normalizeError('Chunk 0a8c960b11 failed at https://b.vercel.app/y.js line 99'))
  })
})

describe('which PRs get smoke-tested', () => {
  const att = (id: string, at: string, prUrl?: string) => ({ type: 'attempt', id, runId: 'r', at, repo: 'o/r', kind: 'fix-lint', taskTier: 1, tier: 'M1', model: 'm', harness: 'claude-code', outcome: 'verified', reason: '', exploring: false, durationMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, ...(prUrl ? { prUrl } : {}) }) as LedgerEntry
  const now = new Date('2026-10-10T12:00:00Z')
  it('open PRs older than the preview build time, once each', () => {
    const entries: LedgerEntry[] = [
      att('a', '2026-10-10T11:00:00Z', 'https://github.com/o/r/pull/1'),
      att('b', '2026-10-10T11:58:00Z', 'https://github.com/o/r/pull/2'), // too fresh: preview still building
      att('c', '2026-10-10T10:00:00Z'),                                   // no PR
      att('d', '2026-10-10T10:00:00Z', 'https://github.com/o/r/pull/3'),
      { type: 'resolution', attemptId: 'd', at: '2026-10-10T11:00:00Z', outcome: 'merged' },
      att('e', '2026-10-10T10:00:00Z', 'https://github.com/o/r/pull/4'),
      { type: 'smoke', attemptId: 'e', at: '', repo: 'o/r', prUrl: 'x', verdict: 'pass', reasons: [] },
    ]
    expect(pendingSmokes(entries, now).map(a => a.id)).toEqual(['a'])
  })
  it('the PR comment says what was compared and why it failed', () => {
    const e: SmokeEntry = { type: 'smoke', attemptId: 'a', at: '', repo: 'o/r', prUrl: 'p', verdict: 'fail', previewUrl: 'https://pv', productionUrl: 'https://prod', reasons: ['/: HTTP 500 on the preview'] }
    const c = smokeComment(e)
    expect(c).toMatch(/Preview smoke: fail/)
    expect(c).toMatch(/Preview: https:\/\/pv · compared with production: https:\/\/prod/)
    expect(c).toMatch(/- \/: HTTP 500 on the preview/)
  })
})

describe('morning report smoke lines', () => {
  it('counts verdicts and lists failures', () => {
    const e = (verdict: SmokeEntry['verdict'], n: number): SmokeEntry => ({ type: 'smoke', attemptId: String(n), at: '', repo: 'o/r', prUrl: `https://github.com/o/r/pull/${n}`, verdict, reasons: [verdict === 'fail' ? '/: HTTP 500 on the preview' : 'ok'] })
    expect(smokeLines([])).toEqual([])
    expect(smokeLines([e('pass', 1), e('fail', 2), e('skipped', 3)])).toEqual([
      'Preview smoke (last 24h): 1 pass · 1 fail · 1 skipped.',
      '✗ o/r/pull/2: /: HTTP 500 on the preview',
    ])
  })
})
