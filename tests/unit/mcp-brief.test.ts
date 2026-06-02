import { describe, it, expect } from 'vitest'
import {
  formatHealthLine,
  formatLastPush,
  isActionableRepo,
  pickNextAction,
} from '../../mcp/brief'

describe('formatHealthLine', () => {
  it('shows green for healthy scores (>= 75)', () => {
    expect(formatHealthLine(80)).toContain('🟢')
    expect(formatHealthLine(75)).toContain('🟢')
    expect(formatHealthLine(100)).toContain('🟢')
  })

  it('shows yellow for at-risk scores (55-74)', () => {
    expect(formatHealthLine(60)).toContain('🟡')
    expect(formatHealthLine(55)).toContain('🟡')
    expect(formatHealthLine(74)).toContain('🟡')
  })

  it('shows red for dead scores (< 55)', () => {
    expect(formatHealthLine(0)).toContain('🔴')
    expect(formatHealthLine(54)).toContain('🔴')
  })

  it('includes the numeric score', () => {
    expect(formatHealthLine(82)).toContain('82')
    expect(formatHealthLine(43)).toContain('43')
  })

  it('returns ? for null score', () => {
    expect(formatHealthLine(null)).toBe('?/100')
  })
})

describe('formatLastPush', () => {
  it('returns "today" for very recent push', () => {
    expect(formatLastPush(new Date())).toBe('today')
  })

  it('returns "yesterday" for ~1 day ago', () => {
    const d = new Date(Date.now() - 86400_000)
    expect(formatLastPush(d)).toBe('yesterday')
  })

  it('returns "N days ago" for older pushes', () => {
    const d = new Date(Date.now() - 5 * 86400_000)
    expect(formatLastPush(d)).toBe('5 days ago')
  })

  it('returns "never" for null', () => {
    expect(formatLastPush(null)).toBe('never')
  })
})

describe('isActionableRepo', () => {
  const active = { isArchived: false, lifecycleStatus: 'production', purpose: 'Revenue' }

  it('returns true for a normal active repo', () => {
    expect(isActionableRepo(active)).toBe(true)
  })

  it('returns false for archived repos', () => {
    expect(isActionableRepo({ ...active, isArchived: true })).toBe(false)
  })

  it('returns false for sunsetting lifecycle', () => {
    expect(isActionableRepo({ ...active, lifecycleStatus: 'sunsetting' })).toBe(false)
  })

  it('returns false for archived lifecycle', () => {
    expect(isActionableRepo({ ...active, lifecycleStatus: 'archived' })).toBe(false)
  })

  it('returns false for Reference purpose', () => {
    expect(isActionableRepo({ ...active, purpose: 'Reference' })).toBe(false)
  })

  it('returns false for Infrastructure purpose', () => {
    expect(isActionableRepo({ ...active, purpose: 'Infrastructure' })).toBe(false)
  })

  it('returns true for Learning purpose (actively learning)', () => {
    expect(isActionableRepo({ ...active, purpose: 'Learning' })).toBe(true)
  })
})

describe('pickNextAction', () => {
  const repoMap = new Map([
    [1, { isArchived: false, lifecycleStatus: 'production', purpose: 'Revenue', isFocused: true }],
    [2, { isArchived: false, lifecycleStatus: 'sunsetting', purpose: 'Revenue', isFocused: false }],
    [3, { isArchived: false, lifecycleStatus: 'production', purpose: 'Reference', isFocused: false }],
    [4, { isArchived: true,  lifecycleStatus: 'archived',   purpose: 'Revenue', isFocused: false }],
    [5, { isArchived: false, lifecycleStatus: 'production', purpose: 'Learning', isFocused: false }],
  ])

  const makeAction = (repoId: number) => ({
    repoId, repoName: `repo-${repoId}`,
    action: 'Do something', estimatedImpact: '+10 pts',
    effort: 'quick', reasoning: 'Because',
  })

  it('picks the first actionable repo from the actions list', () => {
    const result = pickNextAction([makeAction(1), makeAction(2)], repoMap)
    expect(result?.repoId).toBe(1)
  })

  it('skips sunsetting repos', () => {
    const result = pickNextAction([makeAction(2), makeAction(1)], repoMap)
    expect(result?.repoId).toBe(1)
  })

  it('skips Reference repos', () => {
    const result = pickNextAction([makeAction(3), makeAction(5)], repoMap)
    expect(result?.repoId).toBe(5)
  })

  it('skips archived repos', () => {
    const result = pickNextAction([makeAction(4), makeAction(1)], repoMap)
    expect(result?.repoId).toBe(1)
  })

  it('returns null when all actions are for non-actionable repos', () => {
    const result = pickNextAction([makeAction(2), makeAction(3), makeAction(4)], repoMap)
    expect(result).toBeNull()
  })

  it('returns null for empty action list', () => {
    expect(pickNextAction([], repoMap)).toBeNull()
  })
})
