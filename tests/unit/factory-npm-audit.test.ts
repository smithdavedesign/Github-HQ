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
