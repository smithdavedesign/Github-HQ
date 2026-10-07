import { describe, expect, it } from 'vitest'
import { isAllowedGithubLogin } from '@/lib/auth-allowlist'

describe('sign-in allowlist (a personal tool)', () => {
  it('lets only the listed GitHub logins in, ignoring case and spaces', () => {
    expect(isAllowedGithubLogin('smithdavedesign', 'smithdavedesign')).toBe(true)
    expect(isAllowedGithubLogin('SmithDaveDesign', ' smithdavedesign , other ')).toBe(true)
    expect(isAllowedGithubLogin('other', 'smithdavedesign,other')).toBe(true)
    expect(isAllowedGithubLogin('someone-else', 'smithdavedesign')).toBe(false)
  })
  it('refuses a profile without a login once a list is set', () => {
    expect(isAllowedGithubLogin(undefined, 'smithdavedesign')).toBe(false)
    expect(isAllowedGithubLogin(null, 'smithdavedesign')).toBe(false)
  })
  it('unset or empty keeps sign-in open (local development)', () => {
    expect(isAllowedGithubLogin('anyone', undefined)).toBe(true)
    expect(isAllowedGithubLogin('anyone', ' , ')).toBe(true)
  })
})
