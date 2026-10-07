/**
 * G7 — Full Lifecycle gstack Integration unit tests.
 * Tests the skill taxonomy, defaults, inference logic, and routing.
 * No DB or network calls — all pure functions.
 */
import { describe, it, expect } from 'vitest'
import { SKILL_META } from '../../src/lib/skills/skill-policy'
import type { GstackSkill } from '../../src/lib/skills/skill-policy'
import { modeForSkill } from '../../src/lib/agents/factory-request-utils'

// ─── Skill taxonomy completeness ──────────────────────────────────────────────

const ALL_SKILLS: GstackSkill[] = [
  'investigate', 'review',
  'qa-only', 'qa',
  'ship', 'document-release',
  'health', 'canary',
  'retro',
]

const LIFECYCLE_PHASES = ['Understand', 'Build Quality', 'Ship', 'Monitor', 'Reflect']

describe('SKILL_META — taxonomy', () => {
  it('defines all 9 skills', () => {
    expect(Object.keys(SKILL_META)).toHaveLength(9)
    for (const skill of ALL_SKILLS) {
      expect(SKILL_META).toHaveProperty(skill)
    }
  })

  it('every skill has a label, phase, and type', () => {
    for (const [skill, meta] of Object.entries(SKILL_META)) {
      expect(meta.label, `${skill} missing label`).toBeTruthy()
      expect(meta.phase, `${skill} missing phase`).toBeTruthy()
      expect(['report', 'fix', 'pr'], `${skill} invalid type`).toContain(meta.type)
    }
  })

  it('all 5 lifecycle phases are represented', () => {
    const phases = new Set(Object.values(SKILL_META).map(m => m.phase))
    for (const phase of LIFECYCLE_PHASES) {
      expect(phases.has(phase), `Phase "${phase}" not covered`).toBe(true)
    }
  })

  it('report-only skills never create PRs', () => {
    const reportSkills: GstackSkill[] = ['review', 'qa-only', 'health', 'canary', 'retro']
    for (const skill of reportSkills) {
      expect(SKILL_META[skill].type, `${skill} should be report`).toBe('report')
    }
  })

  // Agent HQ (roadmap Phase 81): the factory turns fix skills into one judged draft PR and runs
  // every other skill as a read-only report (docs/agent-hq-migration-prd.md §8).
  it('/ship, /qa and /document-release are the PR-creating skills', () => {
    const prSkills = ALL_SKILLS.filter(s => SKILL_META[s].type === 'pr')
    expect(prSkills.sort()).toEqual(['document-release', 'qa', 'ship'])
  })

  it('/investigate is a read-only report in the factory', () => {
    expect(SKILL_META.investigate.type).toBe('report')
    expect(modeForSkill('investigate')).toBe('report')
  })

  it('the launcher label agrees with what the factory does', () => {
    for (const skill of ALL_SKILLS) {
      const mode = modeForSkill(skill)
      if (mode === null) continue // canary: not available in the factory
      expect(SKILL_META[skill].type === 'pr', `${skill}: type ${SKILL_META[skill].type} vs mode ${mode}`).toBe(mode === 'fix')
    }
  })
})

// ─── Suggested action inference (getSuggestedActions logic) ───────────────────

// Mirror of the inference logic from skill-report-findings.tsx
function inferActions(skillName: string | undefined, findings: string[]): string[] {
  const text = findings.join(' ').toLowerCase()
  const actions: string[] = []

  if (skillName === 'health' || skillName === 'qa-only') {
    if (text.includes('typescript') || text.includes('type error')) actions.push('fix-typescript')
    if (text.includes('dead code') || text.includes('never imported') || text.includes('unused')) actions.push('remove-dead-code')
    if (text.includes('no test') || text.includes('missing test') || text.includes('untested')) actions.push('add-tests')
    if (text.includes('build fail') || text.includes('build error')) actions.push('investigate-build')
  }

  if (skillName === 'review') {
    if (text.includes('security') || text.includes('vulnerability')) actions.push('investigate-security')
    if (text.includes('logic') || text.includes('incorrect') || text.includes('bug')) actions.push('fix-logic')
  }

  return actions
}

describe('getSuggestedActions — inference', () => {
  it('suggests /ship for TypeScript errors in health report', () => {
    const actions = inferActions('health', ['TypeScript: proxy.ts exports a config object but it will never run'])
    expect(actions).toContain('fix-typescript')
  })

  it('suggests /ship for dead code', () => {
    const actions = inferActions('health', ['Dead code: getEventsByTypeAndTrip — never imported outside snapshot'])
    expect(actions).toContain('remove-dead-code')
  })

  it('suggests /investigate for build failures', () => {
    const actions = inferActions('health', ['Build error: module not found in CI'])
    expect(actions).toContain('investigate-build')
  })

  it('suggests /investigate for security findings in review', () => {
    const actions = inferActions('review', ['Security: SQL injection vulnerability in user input handling'])
    expect(actions).toContain('investigate-security')
  })

  it('suggests /ship for logic issues in review', () => {
    const actions = inferActions('review', ['Logic error: incorrect calculation in discount function'])
    expect(actions).toContain('fix-logic')
  })

  it('returns no actions for clean reports', () => {
    // Passing findings don't mention error keywords — "0 errors" doesn't trigger
    const actions = inferActions('health', ['✅ 0 compile issues', '✅ All 100 tests pass', '✅ Codebase is clean'])
    expect(actions).toHaveLength(0)
  })

  it('returns no actions for retro (no code fixes needed)', () => {
    const actions = inferActions('retro', ['Good commit cadence this week', 'Focus on backend improvements'])
    expect(actions).toHaveLength(0)
  })

  it('handles mixed findings and caps suggestions', () => {
    const findings = [
      'TypeScript: proxy.ts has type errors',
      'Dead code: 3 unused exports',
      'No tests for auth module',
    ]
    const actions = inferActions('health', findings)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.length).toBeLessThanOrEqual(4) // bounded
  })
})

// ─── Skill phase groupings ────────────────────────────────────────────────────

describe('skill phase groupings', () => {
  it('Understand phase contains investigate + review', () => {
    const understandSkills = ALL_SKILLS.filter(s => SKILL_META[s].phase === 'Understand')
    expect(understandSkills.sort()).toEqual(['investigate', 'review'].sort())
  })

  it('Build Quality phase contains qa variants', () => {
    const bqSkills = ALL_SKILLS.filter(s => SKILL_META[s].phase === 'Build Quality')
    expect(bqSkills.sort()).toEqual(['qa', 'qa-only'].sort())
  })

  it('Ship phase contains ship + document-release', () => {
    const shipSkills = ALL_SKILLS.filter(s => SKILL_META[s].phase === 'Ship')
    expect(shipSkills.sort()).toEqual(['document-release', 'ship'].sort())
  })

  it('Monitor phase contains health + canary', () => {
    const monitorSkills = ALL_SKILLS.filter(s => SKILL_META[s].phase === 'Monitor')
    expect(monitorSkills.sort()).toEqual(['canary', 'health'].sort())
  })

  it('Reflect phase contains retro', () => {
    const reflectSkills = ALL_SKILLS.filter(s => SKILL_META[s].phase === 'Reflect')
    expect(reflectSkills).toEqual(['retro'])
  })
})

// ─── skill → factory routing (Phase 81) ──────────────────────────────────────

describe('skill → factory routing', () => {
  it('every skill but canary has a factory mode', () => {
    for (const skill of ALL_SKILLS) {
      if (skill === 'canary') expect(modeForSkill(skill)).toBeNull()
      else expect(['fix', 'report']).toContain(modeForSkill(skill))
    }
  })

  it('canary says why it is unavailable', () => {
    expect(SKILL_META.canary.typeLabel).toBe('Unavailable')
    expect(SKILL_META.canary.description).toMatch(/sandbox/)
  })
})

// ─── Active agents summary logic ─────────────────────────────────────────────

describe('active agents stage derivation', () => {
  type EventType = 'agent_task_queued' | 'agent_pr_created' | 'agent_pr_merged' | 'agent_skill_report' | 'agent_execution_failed'

  function isActiveTask(events: Array<{ eventType: EventType; taskId: string }>): boolean {
    const mergedIds = new Set(events.filter(e => e.eventType === 'agent_pr_merged').map(e => e.taskId))
    const reportedIds = new Set(events.filter(e => e.eventType === 'agent_skill_report').map(e => e.taskId))
    const failedIds = new Set(events.filter(e => e.eventType === 'agent_execution_failed').map(e => e.taskId))
    const queued = events.filter(e => e.eventType === 'agent_task_queued')
    return queued.some(e => !mergedIds.has(e.taskId) && !reportedIds.has(e.taskId) && !failedIds.has(e.taskId))
  }

  it('task is active when queued but not merged/reported/failed', () => {
    expect(isActiveTask([{ eventType: 'agent_task_queued', taskId: 't1' }])).toBe(true)
  })

  it('task is inactive when pr_merged', () => {
    expect(isActiveTask([
      { eventType: 'agent_task_queued', taskId: 't1' },
      { eventType: 'agent_pr_merged',  taskId: 't1' },
    ])).toBe(false)
  })

  it('task is inactive when skill_report received', () => {
    expect(isActiveTask([
      { eventType: 'agent_task_queued',  taskId: 't1' },
      { eventType: 'agent_skill_report', taskId: 't1' },
    ])).toBe(false)
  })

  it('task is inactive when execution failed', () => {
    expect(isActiveTask([
      { eventType: 'agent_task_queued',      taskId: 't1' },
      { eventType: 'agent_execution_failed', taskId: 't1' },
    ])).toBe(false)
  })

  it('pr_ready (pr_created without merge) is still active', () => {
    expect(isActiveTask([
      { eventType: 'agent_task_queued', taskId: 't1' },
      { eventType: 'agent_pr_created', taskId: 't1' },
    ])).toBe(true)
  })
})
