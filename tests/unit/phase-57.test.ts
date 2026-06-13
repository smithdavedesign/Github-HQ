/**
 * Phase 57 — OpenClaw Integration tests
 *
 * Covers the three pure-function additions:
 *   1. isGstackSkill()   — runtime type guard for skill names
 *   2. secretsEqual()    — constant-time secret comparison
 *   3. inferNextSkill()  — keyword-based next-skill suggestion
 *
 * inferNextSkill lives in AI-Took-My-Job; we test its logic here by importing
 * the equivalent RepoHQ suggest-actions.ts function which mirrors it exactly.
 * Any divergence between the two functions is a bug.
 */
import { describe, it, expect } from 'vitest'
import { isGstackSkill } from '../../src/lib/actions/nexus-utils'
import { secretsEqual } from '../../src/lib/crypto-utils'
import { getSuggestedActions } from '../../src/lib/skills/suggest-actions'

// ─── isGstackSkill ────────────────────────────────────────────────────────────

describe('isGstackSkill', () => {
  const VALID: string[] = [
    'investigate', 'review', 'qa-only', 'qa',
    'ship', 'document-release', 'health', 'canary', 'retro',
  ]

  it.each(VALID)('returns true for valid skill: %s', (skill) => {
    expect(isGstackSkill(skill)).toBe(true)
  })

  it('returns false for unknown string', () => {
    expect(isGstackSkill('hack-the-mainframe')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isGstackSkill('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isGstackSkill(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isGstackSkill(undefined)).toBe(false)
  })

  it('returns false for number', () => {
    expect(isGstackSkill(42)).toBe(false)
  })

  it('returns false for near-miss (extra char)', () => {
    expect(isGstackSkill('ships')).toBe(false)
    expect(isGstackSkill('investigat')).toBe(false)
  })

  it('returns false for uppercase variant', () => {
    expect(isGstackSkill('SHIP')).toBe(false)
    expect(isGstackSkill('Health')).toBe(false)
  })

  it('acts as a type guard — narrowed value is assignable to GstackSkill', () => {
    const raw: unknown = 'ship'
    if (isGstackSkill(raw)) {
      // TypeScript would error here if raw weren't narrowed to GstackSkill
      const skill: import('../../src/lib/actions/nexus-utils').GstackSkill = raw
      expect(skill).toBe('ship')
    } else {
      expect.fail('should have been a valid skill')
    }
  })
})

// ─── secretsEqual ─────────────────────────────────────────────────────────────

describe('secretsEqual', () => {
  it('returns true for identical secrets', () => {
    expect(secretsEqual('abc123xyz', 'abc123xyz')).toBe(true)
  })

  it('returns true for long secrets', () => {
    const s = 'a'.repeat(64)
    expect(secretsEqual(s, s)).toBe(true)
  })

  it('returns false when secrets differ by one char', () => {
    expect(secretsEqual('abc123xyz', 'abc123xyZ')).toBe(false)
  })

  it('returns false when secrets differ by length (a longer)', () => {
    expect(secretsEqual('abc123xyz!', 'abc123xyz')).toBe(false)
  })

  it('returns false when secrets differ by length (b longer)', () => {
    expect(secretsEqual('abc123xyz', 'abc123xyz!')).toBe(false)
  })

  it('returns false for empty string a', () => {
    expect(secretsEqual('', 'abc')).toBe(false)
  })

  it('returns false for empty string b', () => {
    expect(secretsEqual('abc', '')).toBe(false)
  })

  it('returns false for both empty', () => {
    // Two unknown secrets should never compare equal — fail-closed
    expect(secretsEqual('', '')).toBe(false)
  })

  it('returns false for completely different secrets of the same length', () => {
    expect(secretsEqual('aaaaaaaa', 'bbbbbbbb')).toBe(false)
  })

  it('handles hex secrets (typical openssl rand -hex 32 output)', () => {
    const s = 'f3a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'
    expect(secretsEqual(s, s)).toBe(true)
    expect(secretsEqual(s, s.slice(0, -1) + '2')).toBe(false)
  })
})

// ─── inferNextSkill (via getSuggestedActions mirror) ─────────────────────────
// Tests the keyword→next-skill logic added in Phase 57 for the 5 new skill branches:
// investigate, canary, qa, ship, document-release.
// (health/qa-only/review/retro were already covered in skill-report-logic.test.ts)

const REPO = 'test-repo'

describe('inferNextSkill — investigate branch', () => {
  it('"fix" keyword → /ship', () => {
    const actions = getSuggestedActions('investigate', ['Should fix the memory allocation strategy'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"patch" keyword → /ship', () => {
    const actions = getSuggestedActions('investigate', ['Need to patch the retry logic'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"race condition" → /ship', () => {
    const actions = getSuggestedActions('investigate', ['Found race condition in worker spawn'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"memory leak" → /ship', () => {
    const actions = getSuggestedActions('investigate', ['memory leak detected in event listener'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"infinite loop" → /ship', () => {
    const actions = getSuggestedActions('investigate', ['infinite loop risk in recursive resolver'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('clean investigation → no suggestion', () => {
    const actions = getSuggestedActions('investigate', ['Root cause identified: external API timeout. No code changes needed.'], REPO)
    expect(actions).toHaveLength(0)
  })
})

describe('inferNextSkill — canary branch', () => {
  it('"error" → /investigate', () => {
    const actions = getSuggestedActions('canary', ['Console error: Failed to fetch /api/repos'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('"timeout" → /investigate', () => {
    const actions = getSuggestedActions('canary', ['Request timeout after 30s on /api/sync'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('"slow" → /health', () => {
    const actions = getSuggestedActions('canary', ['Page load slow: 4.2s on dashboard'], REPO)
    expect(actions[0]?.skill).toBe('health')
  })

  it('"latency" → /health', () => {
    const actions = getSuggestedActions('canary', ['API latency p99 elevated at 800ms'], REPO)
    expect(actions[0]?.skill).toBe('health')
  })

  it('clean canary → no suggestion', () => {
    const actions = getSuggestedActions('canary', ['All checks green. 200ms avg response.'], REPO)
    expect(actions).toHaveLength(0)
  })
})

describe('inferNextSkill — qa branch', () => {
  it('"bug" → /ship', () => {
    const actions = getSuggestedActions('qa', ['bug: delete button removes wrong repo'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"crash" → /ship', () => {
    const actions = getSuggestedActions('qa', ['crash on mobile viewport < 375px'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"regression" → /ship', () => {
    const actions = getSuggestedActions('qa', ['regression: sync button broken after last deploy'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"security" → /investigate', () => {
    const actions = getSuggestedActions('qa', ['security: CSRF token missing on form submit'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('"xss" → /investigate', () => {
    const actions = getSuggestedActions('qa', ['xss: user input reflected unescaped in tooltip'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('clean qa → no suggestion', () => {
    const actions = getSuggestedActions('qa', ['All 42 test cases pass. No issues found.'], REPO)
    expect(actions).toHaveLength(0)
  })
})

describe('inferNextSkill — ship branch', () => {
  it('"deploy" → /canary', () => {
    const actions = getSuggestedActions('ship', ['PR merged and deployed to production'], REPO)
    expect(actions[0]?.skill).toBe('canary')
  })

  it('"production" → /canary', () => {
    const actions = getSuggestedActions('ship', ['Changes are now live in production'], REPO)
    expect(actions[0]?.skill).toBe('canary')
  })

  it('"test" → /qa-only', () => {
    const actions = getSuggestedActions('ship', ['PR created — recommend running test suite'], REPO)
    expect(actions[0]?.skill).toBe('qa-only')
  })

  it('no relevant keywords → no suggestion', () => {
    const actions = getSuggestedActions('ship', ['PR created successfully: Fix null check in auth'], REPO)
    expect(actions).toHaveLength(0)
  })
})

describe('inferNextSkill — document-release branch', () => {
  it('"outdated" → /ship', () => {
    const actions = getSuggestedActions('document-release', ['README is outdated — still references old API'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"missing" → /ship', () => {
    const actions = getSuggestedActions('document-release', ['CHANGELOG missing entries for last 3 releases'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('"incomplete" → /ship', () => {
    const actions = getSuggestedActions('document-release', ['Setup guide is incomplete — stops at step 3'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('fully documented → no suggestion', () => {
    const actions = getSuggestedActions('document-release', ['All docs current. CHANGELOG updated through v2.1.0.'], REPO)
    expect(actions).toHaveLength(0)
  })
})
