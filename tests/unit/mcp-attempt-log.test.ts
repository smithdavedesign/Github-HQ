/**
 * Phase 51 — Attempt log & failure feedback unit tests.
 *
 * Tests the logic for parsing attempt outcomes, building attempt history,
 * and the dead-end filtering without DB access.
 */
import { describe, it, expect } from 'vitest'

// ─── Attempt outcome helpers ──────────────────────────────────────────────────

type Outcome = 'success' | 'failed' | 'partial'

function outcomeEmoji(outcome: Outcome): string {
  return outcome === 'success' ? '✅' : outcome === 'partial' ? '⚠️' : '❌'
}

function isDeadEnd(outcome: Outcome): boolean {
  return outcome === 'failed'
}

describe('attempt outcome helpers', () => {
  it('returns correct emoji for each outcome', () => {
    expect(outcomeEmoji('success')).toBe('✅')
    expect(outcomeEmoji('partial')).toBe('⚠️')
    expect(outcomeEmoji('failed')).toBe('❌')
  })

  it('only failed counts as a dead end', () => {
    expect(isDeadEnd('failed')).toBe(true)
    expect(isDeadEnd('success')).toBe(false)
    expect(isDeadEnd('partial')).toBe(false)
  })
})

// ─── Attempt history formatting for coding brief ─────────────────────────────

interface Attempt {
  action: string
  outcome: Outcome
  reason?: string
  date: string
}

function formatAttemptLine(a: Attempt): string {
  const emoji = outcomeEmoji(a.outcome)
  return `- ${emoji} **${a.date}**: ${a.action}${a.reason ? ` — ${a.reason}` : ''}`
}

function shouldWarn(attempts: Attempt[]): boolean {
  return attempts.filter(a => a.outcome === 'failed').length >= 2
}

describe('attempt history formatting', () => {
  it('formats a success line correctly', () => {
    const line = formatAttemptLine({ action: 'add unit tests', outcome: 'success', date: '2026-06-01' })
    expect(line).toContain('✅')
    expect(line).toContain('add unit tests')
    expect(line).toContain('2026-06-01')
  })

  it('formats a failed line with reason', () => {
    const line = formatAttemptLine({ action: 'fix CVE-2024-1234', outcome: 'failed', reason: 'no matching patch', date: '2026-06-01' })
    expect(line).toContain('❌')
    expect(line).toContain('no matching patch')
  })

  it('omits reason section when not provided', () => {
    const line = formatAttemptLine({ action: 'update deps', outcome: 'partial', date: '2026-06-01' })
    expect(line).not.toContain('—')
    expect(line).toContain('⚠️')
  })

  it('warns when 2+ failures present', () => {
    const attempts: Attempt[] = [
      { action: 'fix thing', outcome: 'failed', date: '2026-06-01' },
      { action: 'fix thing', outcome: 'failed', date: '2026-06-02' },
    ]
    expect(shouldWarn(attempts)).toBe(true)
  })

  it('does not warn with fewer than 2 failures', () => {
    const attempts: Attempt[] = [
      { action: 'fix thing', outcome: 'failed', date: '2026-06-01' },
      { action: 'other thing', outcome: 'success', date: '2026-06-02' },
    ]
    expect(shouldWarn(attempts)).toBe(false)
  })

  it('does not warn when failures are all partial', () => {
    const attempts: Attempt[] = [
      { action: 'fix thing', outcome: 'partial', date: '2026-06-01' },
      { action: 'fix thing', outcome: 'partial', date: '2026-06-02' },
    ]
    expect(shouldWarn(attempts)).toBe(false)
  })
})

// ─── get_next_action dead-end skip logic ─────────────────────────────────────

interface AdvisorAction {
  repoId: number
  repoName: string
  action: string
}

function shouldSkipForDeadEnd(action: AdvisorAction, deadEnds: Set<string>): boolean {
  const key = `${action.repoId}::${action.action.toLowerCase().slice(0, 60)}`
  return deadEnds.has(key)
}

describe('dead-end skip in get_next_action', () => {
  it('skips an action that is a known dead end', () => {
    const deadEnds = new Set(['1::add unit tests'])
    const action: AdvisorAction = { repoId: 1, repoName: 'my-repo', action: 'add unit tests' }
    expect(shouldSkipForDeadEnd(action, deadEnds)).toBe(true)
  })

  it('does not skip an action that is not a dead end', () => {
    const deadEnds = new Set(['1::add unit tests'])
    const action: AdvisorAction = { repoId: 1, repoName: 'my-repo', action: 'update readme' }
    expect(shouldSkipForDeadEnd(action, deadEnds)).toBe(false)
  })

  it('does not skip the same action on a different repo', () => {
    const deadEnds = new Set(['1::add unit tests'])
    const action: AdvisorAction = { repoId: 2, repoName: 'other-repo', action: 'add unit tests' }
    expect(shouldSkipForDeadEnd(action, deadEnds)).toBe(false)
  })

  it('is case-insensitive', () => {
    const deadEnds = new Set(['1::add unit tests'])
    const action: AdvisorAction = { repoId: 1, repoName: 'my-repo', action: 'Add Unit Tests' }
    expect(shouldSkipForDeadEnd(action, deadEnds)).toBe(true)
  })
})
