/**
 * Tests for the skill suggestion engine (src/lib/skills/suggest-actions.ts).
 * Imports the real function — not a mirror — so tests are authoritative.
 */
import { describe, it, expect } from 'vitest'
import { getSuggestedActions, FINDINGS_PREVIEW_COUNT, MAX_SUGGESTIONS } from '../../src/lib/skills/suggest-actions'

const REPO = 'open-travel'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('FINDINGS_PREVIEW_COUNT is 4', () => {
    expect(FINDINGS_PREVIEW_COUNT).toBe(4)
  })

  it('MAX_SUGGESTIONS is 2', () => {
    expect(MAX_SUGGESTIONS).toBe(2)
  })
})

// ─── getSuggestedActions — health / qa-only ───────────────────────────────────

describe('getSuggestedActions — health / qa-only', () => {
  const SKILLS = ['health', 'qa-only'] as const

  for (const skill of SKILLS) {
    describe(`skill: ${skill}`, () => {
      it('matches "typescript" keyword → /ship Fix TypeScript errors', () => {
        const actions = getSuggestedActions(skill, ['TypeScript: proxy.ts has type error'], REPO)
        expect(actions[0]?.skill).toBe('ship')
        expect(actions[0]?.label).toBe('Fix TypeScript & lint errors')
      })

      it('matches "type error" keyword → /ship', () => {
        const actions = getSuggestedActions(skill, ['type error in auth.ts line 42'], REPO)
        expect(actions[0]?.skill).toBe('ship')
      })

      it('matches "ts error" keyword → /ship', () => {
        const actions = getSuggestedActions(skill, ['ts error: unexpected token'], REPO)
        expect(actions[0]?.skill).toBe('ship')
      })

      it('matches "tsc error" keyword → /ship', () => {
        const actions = getSuggestedActions(skill, ['tsc error: Cannot find module'], REPO)
        expect(actions[0]?.skill).toBe('ship')
      })

      it('matches "dead code" keyword → /ship Remove dead code', () => {
        const actions = getSuggestedActions(skill, ['Dead code: getEventsByType — never imported'], REPO)
        expect(actions[0]?.skill).toBe('ship')
        expect(actions[0]?.label).toBe('Remove dead code')
      })

      it('matches "never imported" keyword → /ship', () => {
        const actions = getSuggestedActions(skill, ['formatDate() — never imported outside helpers/'], REPO)
        expect(actions[0]?.skill).toBe('ship')
        expect(actions[0]?.label).toBe('Remove dead code')
      })

      it('matches "unused export" keyword → /ship', () => {
        const actions = getSuggestedActions(skill, ['unused export: calculateTotal'], REPO)
        expect(actions[0]?.label).toBe('Remove dead code')
      })

      it('matches "no test" → /ship Add missing tests', () => {
        const actions = getSuggestedActions(skill, ['no test coverage for repositories.ts'], REPO)
        expect(actions[0]?.label).toBe('Add missing tests')
      })

      it('matches "coverage gap" → /ship', () => {
        const actions = getSuggestedActions(skill, ['coverage gap: 7 of 15 action files untested'], REPO)
        expect(actions[0]?.label).toBe('Add missing tests')
      })

      it('matches "build fail" → /investigate Investigate failing build', () => {
        const actions = getSuggestedActions(skill, ['build fail: module not found'], REPO)
        expect(actions[0]?.skill).toBe('investigate')
        expect(actions[0]?.label).toBe('Investigate failing build')
      })

      it('matches "build error" → /investigate', () => {
        const actions = getSuggestedActions(skill, ['build error in CI — exit 1'], REPO)
        expect(actions[0]?.skill).toBe('investigate')
      })

      it('matches "compile failed" → /investigate', () => {
        const actions = getSuggestedActions(skill, ['compile failed: unexpected token at line 3'], REPO)
        expect(actions[0]?.skill).toBe('investigate')
      })

      it('objective contains repo name', () => {
        const actions = getSuggestedActions(skill, ['TypeScript: type error'], REPO)
        expect(actions[0]?.objective).toContain(REPO)
      })

      it('caps at MAX_SUGGESTIONS even with 3+ matching patterns', () => {
        const findings = [
          'typescript: proxy.ts has type errors',
          'dead code: 3 unused exports',
          'no test coverage for 7 files',
          'build fail: module not found',
        ]
        const actions = getSuggestedActions(skill, findings, REPO)
        expect(actions.length).toBeLessThanOrEqual(MAX_SUGGESTIONS)
      })

      it('de-dupes by skill — only one /ship even with two /ship-triggering patterns', () => {
        const findings = ['typescript error', 'dead code found']
        const actions = getSuggestedActions(skill, findings, REPO)
        const shipCount = actions.filter(a => a.skill === 'ship').length
        expect(shipCount).toBe(1)
      })

      it('generic fallback fires when findings contain ⚠️ but no specific pattern', () => {
        const actions = getSuggestedActions(skill, ['⚠️ Some non-specific warning found'], REPO)
        expect(actions[0]?.skill).toBe('ship')
      })

      it('generic fallback fires on "error" keyword alone', () => {
        const actions = getSuggestedActions(skill, ['An error was found in the config'], REPO)
        expect(actions.length).toBeGreaterThan(0)
      })

      it('returns no actions for fully clean report', () => {
        const actions = getSuggestedActions(skill, [
          '✅ TypeScript: 0 compile issues',
          '✅ Tests: 423/423 passing',
          '✅ Codebase is clean',
        ], REPO)
        expect(actions).toHaveLength(0)
      })
    })
  }
})

// ─── getSuggestedActions — review ────────────────────────────────────────────

describe('getSuggestedActions — review', () => {
  it('matches "security" → /investigate', () => {
    const actions = getSuggestedActions('review', ['Security: SSRF in webhook handler'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
    expect(actions[0]?.label).toBe('Investigate security issue')
  })

  it('matches "vulnerability" → /investigate', () => {
    const actions = getSuggestedActions('review', ['vulnerability: path traversal in file upload'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('matches "injection" → /investigate', () => {
    const actions = getSuggestedActions('review', ['injection risk: SQL query built with template literal'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('matches "auth bypass" → /investigate', () => {
    const actions = getSuggestedActions('review', ['auth bypass: missing ownership check in updateGoal'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('matches "logic error" → /ship', () => {
    const actions = getSuggestedActions('review', ['logic error: incorrect calculation in discount function'], REPO)
    expect(actions[0]?.skill).toBe('ship')
    expect(actions[0]?.label).toBe('Fix logic issues')
  })

  it('matches "incorrect" → /ship', () => {
    const actions = getSuggestedActions('review', ['return value is incorrect for edge case input'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('matches "bug" → /ship', () => {
    const actions = getSuggestedActions('review', ['bug: off-by-one error in pagination'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('security + logic both present → /investigate first (higher priority), /ship second', () => {
    const actions = getSuggestedActions('review', [
      'Security: CSRF token missing',
      'logic error: wrong sort order',
    ], REPO)
    expect(actions[0]?.skill).toBe('investigate')
    expect(actions[1]?.skill).toBe('ship')
  })

  it('clean review → no suggestions', () => {
    const actions = getSuggestedActions('review', [
      'Code quality: well-structured, consistent error handling',
      'Authorization: all mutations correctly scoped to session.user.id',
    ], REPO)
    expect(actions).toHaveLength(0)
  })
})

// ─── getSuggestedActions — retro ─────────────────────────────────────────────

describe('getSuggestedActions — retro', () => {
  it('matches "test" keyword → /ship Address technical debt', () => {
    const actions = getSuggestedActions('retro', ['test coverage improved but gaps remain in actions/'], REPO)
    expect(actions[0]?.skill).toBe('ship')
    expect(actions[0]?.label).toBe('Address technical debt')
  })

  it('matches "tech debt" → /ship', () => {
    const actions = getSuggestedActions('retro', ['tech debt: several functions need refactoring'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('positive retro with no debt/quality mentions → no suggestions', () => {
    const actions = getSuggestedActions('retro', [
      'Shipped: 3 new features and 2 bug fixes',
      'Highlight: deployment pipeline stabilised',
    ], REPO)
    expect(actions).toHaveLength(0)
  })
})

// ─── getSuggestedActions — edge cases ────────────────────────────────────────

describe('getSuggestedActions — edge cases', () => {
  it('undefined skillName → no actions', () => {
    const actions = getSuggestedActions(undefined, ['TypeScript: type error in auth.ts'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('empty findings → no actions', () => {
    const actions = getSuggestedActions('health', [], REPO)
    expect(actions).toHaveLength(0)
  })

  it('canary skill with error → suggests /investigate (Phase 57)', () => {
    const actions = getSuggestedActions('canary', ['console error: failed to load resource'], REPO)
    expect(actions[0]?.skill).toBe('investigate')
  })

  it('investigate skill → no actions (outputs fix, no inference needed)', () => {
    const actions = getSuggestedActions('investigate', ['Found root cause: missing index on users.email'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('ship skill → no actions', () => {
    const actions = getSuggestedActions('ship', ['PR opened successfully'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('keyword matching is case-insensitive', () => {
    const actions = getSuggestedActions('health', ['TYPESCRIPT ERROR in module'], REPO)
    expect(actions[0]?.skill).toBe('ship')
  })

  it('each action has skill, label, and objective', () => {
    const actions = getSuggestedActions('health', ['typescript error'], REPO)
    expect(actions[0]).toMatchObject({
      skill: expect.any(String),
      label: expect.any(String),
      objective: expect.any(String),
    })
  })
})
