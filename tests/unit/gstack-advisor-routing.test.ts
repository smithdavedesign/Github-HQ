import { describe, it, expect } from 'vitest'
import {
  resolveAdvisorSkill,
  parseRepoSkillAllowlist,
  parseEnvSkillAllowlistMap,
  isSkillAllowedForRepo,
} from '../../src/lib/actions/nexus-utils'

describe('resolveAdvisorSkill', () => {
  it('routes security to investigate', () => {
    expect(resolveAdvisorSkill('security')).toBe('investigate')
  })

  it('routes non-security to ship', () => {
    expect(resolveAdvisorSkill('health')).toBe('ship')
    expect(resolveAdvisorSkill('opportunity')).toBe('ship')
    expect(resolveAdvisorSkill('revenue')).toBe('ship')
  })
})

describe('parseRepoSkillAllowlist', () => {
  it('returns null when tag is absent', () => {
    expect(parseRepoSkillAllowlist(['frontend', 'critical'])).toBeNull()
  })

  it('parses gstack-allow tag values', () => {
    const parsed = parseRepoSkillAllowlist(['gstack-allow:ship,investigate'])
    expect(parsed?.has('ship')).toBe(true)
    expect(parsed?.has('investigate')).toBe(true)
    expect(parsed?.has('health')).toBe(false)
  })

  it('treats all as unrestricted', () => {
    expect(parseRepoSkillAllowlist(['gstack-allow:all'])).toBeNull()
  })
})

describe('parseEnvSkillAllowlistMap', () => {
  it('parses valid JSON mapping', () => {
    const map = parseEnvSkillAllowlistMap('{"owner/repo":["ship","investigate"]}')
    expect(map.get('owner/repo')?.has('ship')).toBe(true)
    expect(map.get('owner/repo')?.has('investigate')).toBe(true)
  })

  it('returns empty map on invalid JSON', () => {
    const map = parseEnvSkillAllowlistMap('{oops')
    expect(map.size).toBe(0)
  })
})

describe('isSkillAllowedForRepo', () => {
  it('allows when no allowlist is provided', () => {
    const ok = isSkillAllowedForRepo('ship', 'owner/repo', null, new Map())
    expect(ok).toBe(true)
  })

  it('uses repo tag allowlist when env map has no entry', () => {
    const tagAllowlist = new Set(['investigate'] as const)
    expect(isSkillAllowedForRepo('investigate', 'owner/repo', tagAllowlist, new Map())).toBe(true)
    expect(isSkillAllowedForRepo('ship', 'owner/repo', tagAllowlist, new Map())).toBe(false)
  })

  it('env map overrides tag allowlist', () => {
    const tagAllowlist = new Set(['investigate'] as const)
    const envMap = new Map([['owner/repo', new Set(['ship'] as const)]])
    expect(isSkillAllowedForRepo('ship', 'owner/repo', tagAllowlist, envMap)).toBe(true)
    expect(isSkillAllowedForRepo('investigate', 'owner/repo', tagAllowlist, envMap)).toBe(false)
  })
})
