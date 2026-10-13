/**
 * "Fix it" on an Advisor security item (/cso) and repos the owner opens to the factory from RepoHQ.
 * The factory's safe fix: npm audit fix (never --force) in the root lockfile and every sub-package's.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { securityFixTask, securityPlan } from '../../factory/lib/tasks'
import { auditFixTargets } from '../../factory/lib/npm-audit'
import { addAudits, lockfileDirs } from '../../factory/lib/checks'
import { withOpenedRepos } from '../../src/lib/agents/factory-request-utils'

const counts = (critical: number, high: number) => ({ critical, high, moderate: 0, low: 0 })

describe('securityPlan', () => {
  it('fixes the root and every sub-package lockfile', () => {
    expect(securityPlan({ repo: 'o/site', root: true, dirs: ['portfolio-v4'], audit: counts(7, 50) }))
      .toEqual({ action: 'fix', places: ['', 'portfolio-v4'], label: 'the root, portfolio-v4' })
    expect(securityPlan({ repo: 'o/site', root: false, dirs: ['client'], audit: null }), 'npm audit unavailable: tried anyway')
      .toEqual({ action: 'fix', places: ['client'], label: 'client' })
  })
  it('says why when the safe fix has nothing to work on', () => {
    expect(securityPlan({ repo: 'o/py', root: false, dirs: [], audit: null }))
      .toEqual({ action: 'reject', reason: 'o/py has no npm lockfile, so the safe fix (npm audit fix) has nothing to work on. Its alerts need an upgrade by hand.' })
    expect(securityPlan({ repo: 'o/site', root: true, dirs: [], audit: { critical: 0, high: 0, moderate: 4, low: 1 } }))
      .toEqual({ action: 'reject', reason: "npm audit finds nothing critical or high in the root. GitHub's alerts may be in another ecosystem, or already fixed." })
  })
})

describe('securityFixTask', () => {
  it('is a deps-audit task tied to the request, on the lockfiles it may change', () => {
    const t = securityFixTask('req-1', counts(7, 50), ['', 'views/public/lib'])
    expect(t).toMatchObject({ kind: 'deps-audit', ownerTaskId: 'req-1', verify: [], files: ['package-lock.json', 'views/public/lib/package-lock.json'], title: 'Fix security alerts (requested)' })
    expect(t.objective).toBe('`npm audit` reports 7 critical and 50 high severity vulnerabilities in the root, views/public/lib. Apply the non-breaking fixes (`npm audit fix`, never --force).')
    expect(securityFixTask('req-2', null, ['client']).objective).toBe('Apply the non-breaking `npm audit fix` (never --force) in client.')
  })
})

describe('auditFixTargets', () => {
  it('the root with an install, sub-packages lockfile-only, never --force', () => {
    expect(auditFixTargets('/workspace', [], true)).toEqual([{ cwd: '/workspace', args: ['audit', 'fix', '--no-fund'], label: '' }])
    expect(auditFixTargets('/workspace', ['client'], false)).toEqual([{ cwd: '/workspace/client', args: ['audit', 'fix', '--package-lock-only', '--no-fund'], label: 'client' }])
    const both = auditFixTargets('/workspace', ['portfolio-v4', 'views/public/lib'], true)
    expect(both.map(t => [t.cwd, t.label])).toEqual([['/workspace', '(root)'], ['/workspace/portfolio-v4', 'portfolio-v4'], ['/workspace/views/public/lib', 'views/public/lib']])
    expect(both.every(t => !t.args.includes('--force'))).toBe(true)
  })
  it('adds two audits up', () => {
    expect(addAudits(counts(1, 2), { critical: 3, high: 4, moderate: 5, low: 6 })).toEqual({ critical: 4, high: 6, moderate: 5, low: 6 })
    expect(addAudits(null, counts(1, 1))).toEqual(counts(1, 1))
    expect(addAudits(null, null)).toBeNull()
  })
})

describe('lockfileDirs', () => {
  it('finds a vendored library three folders down at depth 4, not at the sensed depth 2', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lockfiles-'))
    const add = (rel: string) => { mkdirSync(path.join(root, rel), { recursive: true }); for (const f of ['package.json', 'package-lock.json']) writeFileSync(path.join(root, rel, f), '{}') }
    add('portfolio-v4')
    add('views/public/janpaepke-ScrollMagic-616edfe')
    mkdirSync(path.join(root, 'node_modules/x'), { recursive: true }); writeFileSync(path.join(root, 'node_modules/x/package-lock.json'), '{}')
    expect(lockfileDirs(root)).toEqual(['portfolio-v4'])
    expect(lockfileDirs(root, 4)).toEqual(['portfolio-v4', 'views/public/janpaepke-ScrollMagic-616edfe'])
  })
})

describe('withOpenedRepos', () => {
  it("adds the repos the owner opened to the config's allowlist, without duplicates", () => {
    expect(withOpenedRepos(['o/a', 'o/B'], ['o/b', 'o/c', 'O/C'])).toEqual(['o/a', 'o/B', 'o/c'])
    expect(withOpenedRepos([], [])).toEqual([])
  })
})
