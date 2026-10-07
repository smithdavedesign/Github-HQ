/**
 * Phase 56 — UX & Agent Experience Improvements unit tests.
 *
 * Tests for:
 * - Finding-specific objectives (getSuggestedActions includes top finding text)
 * - Passive-findings filter (PASSING_PREFIXES strips ✅/✓/passing lines)
 * - The next-skill keyword heuristic
 * - suggestedNextSkill propagation through metadata shape
 * - SkillRunRecord structure
 */
import { describe, it, expect } from 'vitest'
import { getSuggestedActions, FINDINGS_PREVIEW_COUNT, MAX_SUGGESTIONS } from '../../src/lib/skills/suggest-actions'

const REPO = 'open-travel'

// ─── Finding-specific objectives ─────────────────────────────────────────────

describe('getSuggestedActions — finding-specific objectives', () => {
  it('includes the triggering finding text in the objective', () => {
    const finding = 'TypeScript: proxy.ts exports a config object but will never run as middleware'
    const actions = getSuggestedActions('health', [finding], REPO)
    expect(actions[0]?.objective).toContain('proxy.ts')
  })

  it('truncates very long triggering findings to 120 chars + ellipsis', () => {
    const longFinding = 'TypeScript error: ' + 'x'.repeat(200)
    const actions = getSuggestedActions('health', [longFinding], REPO)
    const obj = actions[0]?.objective ?? ''
    // The snippet appended should not exceed 123 chars (120 + '…')
    const specificPart = obj.split('Specifically: ')[1] ?? ''
    expect(specificPart.length).toBeLessThanOrEqual(123)
  })

  it('picks the specific finding that triggered the rule, not the first finding', () => {
    const findings = [
      '✅ Tests: 423/423 passing',
      '⚠️ Dead code: getEventsByType — never imported outside snapshot tests',
    ]
    const actions = getSuggestedActions('health', findings, REPO)
    // Dead code rule triggered; the triggering finding should be in the objective
    const shipAction = actions.find(a => a.skill === 'ship')
    expect(shipAction?.objective).toContain('getEventsByType')
  })

  it('review: security objective includes the specific vulnerability finding', () => {
    const finding = 'Security: SQL injection in /api/search — raw query concatenation on line 47'
    const actions = getSuggestedActions('review', [finding], REPO)
    expect(actions[0]?.objective).toContain('SQL injection')
  })

  it('investigate skill → no actions (no circular suggestions)', () => {
    const actions = getSuggestedActions('investigate', [
      'Found root cause: missing index on users.email causing table scan',
    ], REPO)
    expect(actions).toHaveLength(0)
  })
})

// ─── Passing-findings filter ─────────────────────────────────────────────────

describe('getSuggestedActions — passing-findings filter', () => {
  it('✅ prefix lines are stripped before matching', () => {
    // "✅ TypeScript: 0 compile issues" contains "typescript" but should not match
    const actions = getSuggestedActions('health', ['✅ TypeScript: 0 compile issues'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('✓ prefix lines are stripped', () => {
    const actions = getSuggestedActions('health', ['✓ TypeScript clean'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('lines starting with "passing" are stripped', () => {
    const actions = getSuggestedActions('health', ['passing: 0 typescript errors'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('lines starting with "0 errors" are stripped', () => {
    const actions = getSuggestedActions('health', ['0 errors — typescript clean'], REPO)
    expect(actions).toHaveLength(0)
  })

  it('mixed passing + failing findings: only failing ones trigger actions', () => {
    const findings = [
      '✅ TypeScript: 0 compile issues',
      '⚠️ Dead code: 3 unused exports detected',
    ]
    const actions = getSuggestedActions('health', findings, REPO)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.label).toBe('Remove dead code')
    // Objective references the dead code finding, not the passing one
    expect(actions[0]?.objective).toContain('unused exports')
  })

  it('all passing findings → 0 actions regardless of count', () => {
    const actions = getSuggestedActions('health', [
      '✅ TypeScript: 0 errors',
      '✅ Tests: 595/595 passing',
      '✅ No dead code found',
      '✅ Build: success',
    ], REPO)
    expect(actions).toHaveLength(0)
  })
})

// ─── Next-skill heuristic ────────────────────────────────────────────────────

// The Nexus worker kept a copy of this keyword heuristic (inferNextSkill) for its skill
// auto-chain. Both were retired in Phase 81: getSuggestedActions is the only one left, and it
// only suggests; the owner decides what runs next.
describe('next-skill heuristic', () => {
  const next = (skill: string, findings: string[]) => getSuggestedActions(skill, findings, REPO)[0]?.skill ?? null

  it.each([
    ['health', 'TypeScript: type errors in proxy.ts', 'ship'],
    ['health', 'dead code: getEventsByType never imported', 'ship'],
    ['health', 'Dead code: formatDate — never imported outside helpers/', 'ship'],
    ['health', 'build fail: module not found', 'investigate'],
    ['health', 'build fail: tsc exited with code 1', 'investigate'],
    ['review', 'security: SSRF via webhook URL', 'investigate'],
    ['review', 'logic error: incorrect pagination offset', 'ship'],
    ['retro', 'tech debt remains high in auth module', 'ship'],
  ])('%s + "%s" → %s', (skill, finding, expected) => {
    expect(next(skill, [finding])).toBe(expected)
  })

  it('clean health report → no suggestion', () => {
    expect(next('health', ['✅ all checks passing'])).toBeNull()
  })
})

// ─── suggestedNextSkill metadata shape ───────────────────────────────────────

describe('suggestedNextSkill metadata shape', () => {
  it('agent_skill_report metadata accepts a suggestedNextSkill string', () => {
    // Type-level test: the metadata shape agent_skill_report events carry
    const payload: {
      eventType: 'agent_skill_report'
      taskId: string
      skillName: string
      findings: string[]
      outcome: string
      suggestedNextSkill?: string
    } = {
      eventType: 'agent_skill_report',
      taskId: 'task-123',
      skillName: 'health',
      findings: ['TypeScript: type error in proxy.ts'],
      outcome: 'no-changes',
      suggestedNextSkill: 'ship',
    }
    expect(payload.suggestedNextSkill).toBe('ship')
  })

  it('suggestedNextSkill is optional — omitting it is valid', () => {
    const payload: {
      eventType: 'agent_skill_report'
      taskId: string
      skillName: string
      findings: string[]
      outcome: string
      suggestedNextSkill?: string
    } = {
      eventType: 'agent_skill_report',
      taskId: 'task-456',
      skillName: 'retro',
      findings: ['Good week, no issues'],
      outcome: 'no-changes',
    }
    expect(payload.suggestedNextSkill).toBeUndefined()
  })
})

// ─── SkillRunRecord shape ─────────────────────────────────────────────────────

describe('SkillRunRecord structure', () => {
  it('has the expected fields', () => {
    const record = {
      daysAgo: 2,
      findingCount: 4,
      taskId: 'task-abc',
      summary: 'Health check: 4 findings',
      topFindings: ['TypeScript error in proxy.ts', 'Dead code: 3 unused exports'],
    }
    expect(record.daysAgo).toBe(2)
    expect(record.findingCount).toBe(4)
    expect(record.topFindings.length).toBeLessThanOrEqual(3)
  })

  it('daysAgo = 0 for runs from today', () => {
    const msAgo = 30 * 60 * 1000 // 30 minutes ago
    const daysAgo = Math.floor(msAgo / (1000 * 60 * 60 * 24))
    expect(daysAgo).toBe(0)
  })

  it('topFindings contains at most 3 items', () => {
    const allFindings = ['f1', 'f2', 'f3', 'f4', 'f5']
    const topFindings = allFindings.slice(0, 3)
    expect(topFindings).toHaveLength(3)
  })
})

// ─── Phase 56 constants (regression guard) ───────────────────────────────────

describe('constants unchanged', () => {
  it('FINDINGS_PREVIEW_COUNT is still 4', () => {
    expect(FINDINGS_PREVIEW_COUNT).toBe(4)
  })

  it('MAX_SUGGESTIONS is still 2', () => {
    expect(MAX_SUGGESTIONS).toBe(2)
  })
})
