/**
 * Phase 51 — Closed/rejected PR detection unit tests.
 *
 * Mirrors the pure dedup + classification logic in
 * src/lib/agents/pr-merge-checker.ts (checkMergedAgentPRs). No DB or
 * GitHub API calls — verifies the decision rules in isolation.
 */
import { describe, it, expect } from 'vitest'

type EventType = 'agent_pr_created' | 'agent_pr_merged' | 'agent_pr_rejected'
interface PortfolioEvent {
  eventType: EventType
  metadata: { taskId?: string; prUrl?: string } | null
}

/** Mirrors the mergedTaskIds/rejectedTaskIds/openPRs derivation in checkMergedAgentPRs */
function findOpenPRs(events: PortfolioEvent[]): PortfolioEvent[] {
  const mergedTaskIds = new Set<string>()
  const rejectedTaskIds = new Set<string>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_merged') {
      const taskId = e.metadata?.taskId
      if (taskId) mergedTaskIds.add(taskId)
    }
    if (e.eventType === 'agent_pr_rejected') {
      const taskId = e.metadata?.taskId
      if (taskId) rejectedTaskIds.add(taskId)
    }
  }

  return events.filter(e => {
    if (e.eventType !== 'agent_pr_created') return false
    const taskId = e.metadata?.taskId
    return !!taskId && !mergedTaskIds.has(taskId) && !rejectedTaskIds.has(taskId) && !!e.metadata?.prUrl
  })
}

/** Mirrors the GitHub PR-state classification in checkMergedAgentPRs */
type PRClassification = 'merged' | 'rejected' | 'open'
function classifyPR(prData: { merged_at: string | null; state: string }): PRClassification {
  if (prData.merged_at) return 'merged'
  if (prData.state === 'closed') return 'rejected'
  return 'open'
}

const created = (taskId: string): PortfolioEvent =>
  ({ eventType: 'agent_pr_created', metadata: { taskId, prUrl: `https://github.com/test/r/pull/1` } })
const merged = (taskId: string): PortfolioEvent =>
  ({ eventType: 'agent_pr_merged', metadata: { taskId } })
const rejected = (taskId: string): PortfolioEvent =>
  ({ eventType: 'agent_pr_rejected', metadata: { taskId } })

describe('findOpenPRs', () => {
  it('includes a created PR with no merge/reject event', () => {
    const open = findOpenPRs([created('task-1')])
    expect(open).toHaveLength(1)
  })

  it('excludes a PR that already has agent_pr_merged', () => {
    const open = findOpenPRs([created('task-1'), merged('task-1')])
    expect(open).toHaveLength(0)
  })

  it('excludes a PR that already has agent_pr_rejected (dedup on rerun)', () => {
    const open = findOpenPRs([created('task-1'), rejected('task-1')])
    expect(open).toHaveLength(0)
  })
})

describe('classifyPR', () => {
  it('classifies merged_at set as merged', () => {
    expect(classifyPR({ merged_at: '2026-01-01T00:00:00Z', state: 'closed' })).toBe('merged')
  })

  it('classifies state=closed with no merged_at as rejected', () => {
    expect(classifyPR({ merged_at: null, state: 'closed' })).toBe('rejected')
  })

  it('classifies state=open with no merged_at as open (skip — recheck later)', () => {
    expect(classifyPR({ merged_at: null, state: 'open' })).toBe('open')
  })
})

describe('checkMergedAgentPRs rejection flow', () => {
  it('a closed-without-merge PR is detected once and not re-detected after agent_pr_rejected is recorded', () => {
    // First pass: PR is open, GitHub reports it closed-without-merge.
    const firstPassEvents: PortfolioEvent[] = [created('task-1')]
    const firstPassOpen = findOpenPRs(firstPassEvents)
    expect(firstPassOpen).toHaveLength(1)
    expect(classifyPR({ merged_at: null, state: 'closed' })).toBe('rejected')

    // After inserting agent_pr_rejected, the second pass excludes it.
    const secondPassEvents: PortfolioEvent[] = [...firstPassEvents, rejected('task-1')]
    const secondPassOpen = findOpenPRs(secondPassEvents)
    expect(secondPassOpen).toHaveLength(0)
  })
})
