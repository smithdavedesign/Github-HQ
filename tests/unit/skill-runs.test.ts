import { describe, it, expect } from 'vitest'
import { skillFromObjective, skillRuns } from '@/lib/skills/skill-runs'

const now = new Date('2026-10-12T12:00:00Z')
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000)

describe('skillFromObjective', () => {
  it('reads a gstack skill named in the text, nothing else', () => {
    expect(skillFromObjective('Run /health skill')).toBe('health')
    expect(skillFromObjective('/investigate the 500s on /api/users')).toBe('investigate')
    expect(skillFromObjective('fix src/lib/utils.ts')).toBeNull()
    expect(skillFromObjective('Run /deploy now')).toBeNull()
  })
})

describe('skillRuns', () => {
  it('a finished factory run counts as the latest run, even when its request was labelled /ship', () => {
    const runs = skillRuns(
      [{ occurredAt: ago(119), metadata: { skillName: 'health', findings: ['a', 'b'], taskId: 't-old' } }],
      [{ id: 'r1', skill: 'ship', objective: 'Run /health skill', findings: '## Report\n- tsc clean\n- 2 lint warnings', resolvedAt: ago(0), updatedAt: ago(0) }],
      now,
    )
    expect(runs.health).toMatchObject({ daysAgo: 0, taskId: 'r1', findingCount: 2, topFindings: ['tsc clean', '2 lint warnings'], summary: 'run by the factory' })
  })

  it('keeps a newer skill report over an older request, and files a plain /ship fix under ship', () => {
    const runs = skillRuns(
      [{ occurredAt: ago(1), metadata: { skillName: 'review', findings: ['x'], taskId: 't' } }],
      [
        { id: 'r2', skill: 'review', objective: 'review it', findings: null, resolvedAt: ago(5), updatedAt: ago(5) },
        { id: 'r3', skill: 'ship', objective: 'Add tests for utils', findings: null, resolvedAt: null, updatedAt: ago(2) },
      ],
      now,
    )
    expect(runs.review).toMatchObject({ daysAgo: 1, taskId: 't' })
    expect(runs.ship).toMatchObject({ daysAgo: 2, taskId: 'r3', findingCount: 0 })
  })
})
