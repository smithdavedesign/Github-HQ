import { describe, it, expect } from 'vitest'
import { isArboristCrash, lockfileOnlyRetryArgs } from '../../factory/lib/npm-audit'

describe('npm audit fix: arborist crash retry', () => {
  it("recognises npm's null-edge crash", () => {
    expect(isArboristCrash("npm audit fix\n\nnpm error Cannot read properties of null (reading 'edgesOut')\nnpm error A complete log")).toBe(true)
    expect(isArboristCrash("TypeError: Cannot read property 'children' of undefined")).toBe(false)
    expect(isArboristCrash("Cannot read properties of undefined (reading 'isProjectRoot')")).toBe(true)
    expect(isArboristCrash('fixed 3 of 5 vulnerabilities')).toBe(false)
  })
  it('retries the same fix lockfile-only, once', () => {
    expect(lockfileOnlyRetryArgs(['audit', 'fix', '--no-fund'])).toEqual(['audit', 'fix', '--no-fund', '--package-lock-only'])
    expect(lockfileOnlyRetryArgs(['audit', 'fix', '--package-lock-only', '--no-fund'])).toBeNull()
    expect(lockfileOnlyRetryArgs(['install'])).toBeNull()
  })
})

import { onlyForceFixes } from '../../factory/lib/npm-audit'

describe('npm audit fix: nothing fixable without --force', () => {
  const OPEN_TRAVEL = [
    'postcss  <=8.5.22', 'Severity: high', 'fix available via `npm audit fix --force`',
    'Will install next@16.4.0, which is outside the stated dependency range', 'node_modules/next/node_modules/postcss',
    'sharp  <=0.35.5-rc.1', 'fix available via `npm audit fix --force`',
    'Will install next@16.4.0, which is outside the stated dependency range',
    '11 vulnerabilities (10 high, 1 critical)',
  ].join('\n')
  it('says why instead of "harness failed", naming the upgrade', () => {
    expect(onlyForceFixes(OPEN_TRAVEL)).toBe("no non-breaking fix: every remaining advisory needs `npm audit fix --force` (next@16.4.0), which the factory never runs; needs a major upgrade")
  })
  it('stays out of the way when something was fixed, or for other failures', () => {
    expect(onlyForceFixes(`fixed 3 of 11 vulnerabilities\n${OPEN_TRAVEL}`)).toBeNull()
    expect(onlyForceFixes("npm error Cannot read properties of null (reading 'edgesOut')")).toBeNull()
  })
})
