import { describe, it, expect } from 'vitest'
import {
  resolveSkillPolicyTier,
  resolveConfidenceBand,
  isTierAllowedForLifecycle,
  isTierAllowedByConfidence,
  parseEnvHighRiskOptInMap,
  isHighRiskOptedIn,
  isTierAllowedByProgressiveAutonomy,
} from '../../src/lib/skills/skill-policy'

describe('resolveSkillPolicyTier', () => {
  it('classifies report-only skills', () => {
    expect(resolveSkillPolicyTier('health')).toBe('report-only')
    expect(resolveSkillPolicyTier('qa-only')).toBe('report-only')
  })

  it('classifies security advisor actions as high-risk', () => {
    expect(resolveSkillPolicyTier('investigate', 'security')).toBe('high-risk')
  })

  it('classifies non-security ship as analyze+fix', () => {
    expect(resolveSkillPolicyTier('ship', 'health')).toBe('analyze+fix')
  })
})

describe('resolveConfidenceBand', () => {
  it('returns low when below min data points', () => {
    expect(resolveConfidenceBand(95, 1, 3)).toBe('low')
  })

  it('returns high when >=80 with enough data', () => {
    expect(resolveConfidenceBand(80, 4, 3)).toBe('high')
  })

  it('returns medium when >=50 and <80 with enough data', () => {
    expect(resolveConfidenceBand(60, 4, 3)).toBe('medium')
  })

  it('returns low when <50 with enough data', () => {
    expect(resolveConfidenceBand(49, 4, 3)).toBe('low')
  })
})

describe('isTierAllowedForLifecycle', () => {
  it('blocks analyze+fix for idea', () => {
    expect(isTierAllowedForLifecycle('analyze+fix', 'idea')).toBe(false)
  })

  it('allows analyze+fix for maintaining', () => {
    expect(isTierAllowedForLifecycle('analyze+fix', 'maintaining')).toBe(true)
  })

  it('blocks high-risk for building', () => {
    expect(isTierAllowedForLifecycle('high-risk', 'building')).toBe(false)
  })

  it('allows high-risk for production', () => {
    expect(isTierAllowedForLifecycle('high-risk', 'production')).toBe(true)
  })

  it('allows report-only except archived', () => {
    expect(isTierAllowedForLifecycle('report-only', 'beta')).toBe(true)
    expect(isTierAllowedForLifecycle('report-only', 'archived')).toBe(false)
  })
})

describe('isTierAllowedByConfidence', () => {
  it('always allows report-only', () => {
    expect(isTierAllowedByConfidence('report-only', 'low')).toBe(true)
  })

  it('blocks analyze+fix on low confidence', () => {
    expect(isTierAllowedByConfidence('analyze+fix', 'low')).toBe(false)
  })

  it('allows analyze+fix on medium confidence', () => {
    expect(isTierAllowedByConfidence('analyze+fix', 'medium')).toBe(true)
  })

  it('allows high-risk only on high confidence', () => {
    expect(isTierAllowedByConfidence('high-risk', 'medium')).toBe(false)
    expect(isTierAllowedByConfidence('high-risk', 'high')).toBe(true)
  })
})

describe('progressive autonomy (high-risk opt-in)', () => {
  it('parses env opt-in map', () => {
    const map = parseEnvHighRiskOptInMap('{"owner/repo":true,"owner/other":false}')
    expect(map.get('owner/repo')).toBe(true)
    expect(map.get('owner/other')).toBe(false)
  })

  it('returns false for high-risk without opt-in', () => {
    expect(isHighRiskOptedIn('owner/repo', ['tag:a'], new Map())).toBe(false)
    expect(isTierAllowedByProgressiveAutonomy('high-risk', 'owner/repo', ['tag:a'], new Map())).toBe(false)
  })

  it('allows high-risk with repo tag opt-in', () => {
    const tags = ['gstack-optin:high-risk']
    expect(isHighRiskOptedIn('owner/repo', tags, new Map())).toBe(true)
    expect(isTierAllowedByProgressiveAutonomy('high-risk', 'owner/repo', tags, new Map())).toBe(true)
  })

  it('env override takes precedence over tag', () => {
    const envMap = new Map([['owner/repo', false]])
    const tags = ['gstack-optin:high-risk']
    expect(isHighRiskOptedIn('owner/repo', tags, envMap)).toBe(false)
    expect(isTierAllowedByProgressiveAutonomy('high-risk', 'owner/repo', tags, envMap)).toBe(false)
  })

  it('low-risk tiers remain allowed by default', () => {
    expect(isTierAllowedByProgressiveAutonomy('report-only', 'owner/repo', null, new Map())).toBe(true)
    expect(isTierAllowedByProgressiveAutonomy('analyze+fix', 'owner/repo', null, new Map())).toBe(true)
  })
})
