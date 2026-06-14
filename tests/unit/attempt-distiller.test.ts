/**
 * Phase 54-T4 — weekly attempt distillation unit tests.
 *
 * Covers `distillByAction`, the pure grouping/success-rate logic behind
 * `distillAttempts`. No DB access — distillAttempts itself is a thin
 * fetch/group/write wrapper around this function.
 */
import { describe, it, expect } from 'vitest'
import { distillByAction } from '@/lib/agents/attempt-distiller-utils'

describe('distillByAction', () => {
  it('groups attempts by normalized action and computes success rate', () => {
    const result = distillByAction([
      { action: 'Add unit tests', outcome: 'success' },
      { action: 'add unit tests', outcome: 'failed', reason: 'tests timed out' },
      { action: 'ADD UNIT TESTS', outcome: 'success' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].action).toBe('add unit tests')
    expect(result[0].total).toBe(3)
    expect(result[0].successRate).toBe(0.67)
    expect(result[0].commonFailure).toBe('tests timed out')
  })

  it('keeps distinct actions in separate groups', () => {
    const result = distillByAction([
      { action: 'fix CVE-2024-1234', outcome: 'success' },
      { action: 'add unit tests', outcome: 'failed', reason: 'flaky' },
    ])

    expect(result).toHaveLength(2)
    const actions = result.map(r => r.action)
    expect(actions).toContain('fix cve-2024-1234')
    expect(actions).toContain('add unit tests')
  })

  it('returns commonFailure null when there are no failures', () => {
    const result = distillByAction([
      { action: 'add unit tests', outcome: 'success' },
      { action: 'add unit tests', outcome: 'partial' },
    ])

    expect(result[0].successRate).toBe(0.5)
    expect(result[0].commonFailure).toBeNull()
  })

  it('returns commonFailure null when failures have no reason', () => {
    const result = distillByAction([
      { action: 'add unit tests', outcome: 'failed' },
    ])

    expect(result[0].commonFailure).toBeNull()
  })

  it('picks the most frequent failure reason', () => {
    const result = distillByAction([
      { action: 'fix lint errors', outcome: 'failed', reason: 'missing dependency' },
      { action: 'fix lint errors', outcome: 'failed', reason: 'missing dependency' },
      { action: 'fix lint errors', outcome: 'failed', reason: 'type mismatch' },
    ])

    expect(result[0].commonFailure).toBe('missing dependency')
  })

  it('truncates action keys to 60 chars so near-duplicate long actions collapse', () => {
    const longAction = 'a'.repeat(70) + ' suffix one'
    const longActionVariant = 'a'.repeat(70) + ' suffix two'
    const result = distillByAction([
      { action: longAction, outcome: 'success' },
      { action: longActionVariant, outcome: 'failed', reason: 'oops' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].total).toBe(2)
  })

  it('sorts groups by total descending', () => {
    const result = distillByAction([
      { action: 'rare action', outcome: 'success' },
      { action: 'common action', outcome: 'success' },
      { action: 'common action', outcome: 'failed', reason: 'x' },
      { action: 'common action', outcome: 'success' },
    ])

    expect(result[0].action).toBe('common action')
    expect(result[0].total).toBe(3)
    expect(result[1].action).toBe('rare action')
  })

  it('returns an empty array for no attempts', () => {
    expect(distillByAction([])).toEqual([])
  })
})
