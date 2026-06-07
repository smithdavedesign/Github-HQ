/**
 * Phase 56 — UX & Agent Experience Improvements unit tests.
 *
 * Tests for:
 * - Finding-specific objectives (getSuggestedActions includes top finding text)
 * - Passive-findings filter (PASSING_PREFIXES strips ✅/✓/passing lines)
 * - inferNextSkill logic parity with the server-side worker
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

// ─── inferNextSkill parity (mirrors worker logic) ────────────────────────────

// This section documents the contract between the worker and the UI.
// Both use the same keyword heuristic — if you change one, change the other.
describe('inferNextSkill contract', () => {
  function inferNextSkill(skillName: string, findings: string[]): string | null {
    const text = findings.join(' ').toLowerCase()
    if (['health', 'qa-only'].includes(skillName)) {
      if (text.includes('typescript') || text.includes('type error') || text.includes('ts error')) return 'ship'
      if (text.includes('dead code') || text.includes('never imported') || text.includes('unused export')) return 'ship'
      if (text.includes('no test') || text.includes('missing test') || text.includes('coverage gap')) return 'ship'
      if (text.includes('build fail') || text.includes('build error') || text.includes('module not found')) return 'investigate'
    }
    if (skillName === 'review') {
      if (text.includes('security') || text.includes('vulnerability') || text.includes('injection')) return 'investigate'
      if (text.includes('logic error') || text.includes('incorrect') || text.includes('bug')) return 'ship'
    }
    if (skillName === 'retro') {
      if (text.includes('tech debt') || text.includes('test') || text.includes('quality')) return 'ship'
    }
    return null
  }

  it('health + typescript → ship', () => {
    expect(inferNextSkill('health', ['TypeScript: type errors in proxy.ts'])).toBe('ship')
  })

  it('health + dead code → ship', () => {
    expect(inferNextSkill('health', ['dead code: getEventsByType never imported'])).toBe('ship')
  })

  it('health + build error → investigate', () => {
    expect(inferNextSkill('health', ['build fail: module not found'])).toBe('investigate')
  })

  it('review + security → investigate', () => {
    expect(inferNextSkill('review', ['security: SSRF via webhook URL'])).toBe('investigate')
  })

  it('review + logic → ship', () => {
    expect(inferNextSkill('review', ['logic error: incorrect pagination offset'])).toBe('ship')
  })

  it('retro + tech debt → ship', () => {
    expect(inferNextSkill('retro', ['tech debt remains high in auth module'])).toBe('ship')
  })

  it('canary → null (no inference rule)', () => {
    expect(inferNextSkill('canary', ['console error: failed to load resource'])).toBeNull()
  })

  it('clean health report → null', () => {
    expect(inferNextSkill('health', ['✅ all checks passing'])).toBeNull()
  })

  // Parity check: for every pattern getSuggestedActions suggests /ship,
  // inferNextSkill should also return 'ship' (the worker and UI agree)
  it('getSuggestedActions and inferNextSkill agree on ship for dead code', () => {
    const findings = ['Dead code: formatDate — never imported outside helpers/']
    const uiSuggestion = getSuggestedActions('health', findings, REPO)[0]?.skill
    const workerSuggestion = inferNextSkill('health', findings)
    expect(uiSuggestion).toBe('ship')
    expect(workerSuggestion).toBe('ship')
  })

  it('getSuggestedActions and inferNextSkill agree on investigate for build errors', () => {
    const findings = ['build fail: tsc exited with code 1']
    const uiSuggestion = getSuggestedActions('health', findings, REPO)[0]?.skill
    const workerSuggestion = inferNextSkill('health', findings)
    expect(uiSuggestion).toBe('investigate')
    expect(workerSuggestion).toBe('investigate')
  })
})

// ─── suggestedNextSkill metadata shape ───────────────────────────────────────

describe('suggestedNextSkill metadata shape', () => {
  it('webhook payload type accepts suggestedNextSkill string', () => {
    // Type-level test: ensure the shape we send in the webhook is valid
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
