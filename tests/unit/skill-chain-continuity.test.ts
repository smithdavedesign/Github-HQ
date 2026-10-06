import { describe, it, expect } from 'vitest'
import { buildSkillChainObjective, extractUnresolvedBlockers } from '../../src/lib/skills/chain-continuity'

describe('extractUnresolvedBlockers', () => {
  it('extracts blocker-like findings first', () => {
    const blockers = extractUnresolvedBlockers([
      'Dead code: 3 unused exports',
      'Build failed: module not found for ./worker',
      'Permission denied when writing cache folder',
    ])

    expect(blockers).toEqual([
      'Build failed: module not found for ./worker',
      'Permission denied when writing cache folder',
    ])
  })

  it('falls back to summary fragments when findings have no blocker text', () => {
    const blockers = extractUnresolvedBlockers(
      ['Coverage gap in onboarding flow tests'],
      'Lint check passed. Deploy blocked by missing API key. Follow-up tomorrow.',
    )

    expect(blockers).toEqual(['Deploy blocked by missing API key.'])
  })
})

describe('buildSkillChainObjective', () => {
  it('includes inherited findings and unresolved blockers', () => {
    const objective = buildSkillChainObjective({
      parentSkill: 'health',
      inheritedFindings: ['Dead code: 3 unused exports', 'TypeScript compile error in src/lib/tasks.ts'],
      unresolvedBlockers: ['Build failed: module not found ./worker'],
    })

    expect(objective).toContain('Continue from /health with explicit objective continuity.')
    expect(objective).toContain('Carry forward unresolved findings: Dead code: 3 unused exports; TypeScript compile error in src/lib/tasks.ts')
    expect(objective).toContain('Prioritize unresolved blockers: Build failed: module not found ./worker')
  })

  it('omits blocker line when none are provided', () => {
    const objective = buildSkillChainObjective({
      parentSkill: 'qa-only',
      inheritedFindings: ['Regression in settings save flow'],
      unresolvedBlockers: [],
    })

    expect(objective).toContain('Carry forward unresolved findings: Regression in settings save flow')
    expect(objective).not.toContain('Prioritize unresolved blockers:')
  })
})
