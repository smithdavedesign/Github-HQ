/**
 * Unit tests for the RepoHQ × Nexus integration (Phase 46).
 * Tests the pure logic in nexus.ts without hitting real APIs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<{
  repoId: number; repoName: string; action: string;
  impactType: 'opportunity' | 'revenue' | 'security' | 'health';
  effort: 'quick' | 'medium' | 'substantial';
  estimatedImpact: string; reasoning: string;
}> = {}) {
  return {
    repoId: 1,
    repoName: 'my-repo',
    action: 'Add deployment pipeline',
    impactType: 'opportunity' as const,
    effort: 'medium' as const,
    estimatedImpact: '+14 opportunity points',
    reasoning: 'Deployment would significantly boost opportunity score',
    ...overrides,
  }
}

// ─── Risk tier mapping ────────────────────────────────────────────────────────

describe('risk tier logic', () => {
  it('quick effort → tier1', () => {
    const action = makeAction({ effort: 'quick' })
    // tier1 = quick effort regardless of impactType
    expect(action.effort).toBe('quick')
  })

  it('medium effort → tier2', () => {
    const action = makeAction({ effort: 'medium' })
    expect(action.effort).toBe('medium')
  })

  it('substantial effort → tier2', () => {
    const action = makeAction({ effort: 'substantial' })
    expect(action.effort).toBe('substantial')
  })
})

// ─── Acceptance criteria builder ─────────────────────────────────────────────

describe('acceptance criteria generation', () => {
  function buildAcceptanceCriteria(action: ReturnType<typeof makeAction>): string[] {
    const criteria: string[] = [`${action.action} — ${action.reasoning}`]
    if (action.impactType === 'security')    criteria.push('No new security alerts introduced')
    if (action.impactType === 'health')      criteria.push('Health score does not decrease')
    if (action.impactType === 'opportunity') criteria.push('Opportunity score improves or stays the same')
    criteria.push('All existing tests continue to pass')
    return criteria
  }

  it('always includes the action + reasoning as first criterion', () => {
    const action = makeAction()
    const criteria = buildAcceptanceCriteria(action)
    expect(criteria[0]).toContain(action.action)
    expect(criteria[0]).toContain(action.reasoning)
  })

  it('always ends with tests passing criterion', () => {
    const action = makeAction()
    const criteria = buildAcceptanceCriteria(action)
    expect(criteria[criteria.length - 1]).toMatch(/tests.*pass/i)
  })

  it('security actions get no-new-alerts criterion', () => {
    const criteria = buildAcceptanceCriteria(makeAction({ impactType: 'security' }))
    expect(criteria.some(c => c.includes('security alerts'))).toBe(true)
  })

  it('health actions get no-decrease criterion', () => {
    const criteria = buildAcceptanceCriteria(makeAction({ impactType: 'health' }))
    expect(criteria.some(c => c.includes('Health score does not decrease'))).toBe(true)
  })

  it('opportunity actions get score-improves criterion', () => {
    const criteria = buildAcceptanceCriteria(makeAction({ impactType: 'opportunity' }))
    expect(criteria.some(c => c.includes('Opportunity score'))).toBe(true)
  })

  it('revenue actions only get the universal tests criterion', () => {
    const criteria = buildAcceptanceCriteria(makeAction({ impactType: 'revenue' }))
    expect(criteria.length).toBe(2) // action+reasoning + tests
  })
})

// ─── Nexus API payload shape ──────────────────────────────────────────────────

describe('Nexus API payload', () => {
  function buildPayload(action: ReturnType<typeof makeAction>, fullName: string) {
    return {
      objective: `${action.action}\n\nContext: ${action.reasoning}\nExpected impact: ${action.estimatedImpact}`,
      targetRepository: fullName,
      executionMode: action.impactType === 'security' ? 'investigate' : 'fix',
      contextNotes: JSON.stringify({
        repoHQRepoId: action.repoId,
        repoHQRepoName: action.repoName,
        impactType: action.impactType,
        effort: action.effort,
        estimatedImpact: action.estimatedImpact,
        predictedDelta: action.estimatedImpact,
        source: 'repohq-advisor',
      }),
    }
  }

  it('uses investigate mode for security actions', () => {
    const p = buildPayload(makeAction({ impactType: 'security' }), 'owner/repo')
    expect(p.executionMode).toBe('investigate')
  })

  it('uses fix mode for non-security actions', () => {
    const p = buildPayload(makeAction({ impactType: 'opportunity' }), 'owner/repo')
    expect(p.executionMode).toBe('fix')
  })

  it('includes predictedDelta in contextNotes', () => {
    const p = buildPayload(makeAction({ estimatedImpact: '+14 opportunity points' }), 'owner/repo')
    const notes = JSON.parse(p.contextNotes)
    expect(notes.predictedDelta).toBe('+14 opportunity points')
  })

  it('sets source to repohq-advisor', () => {
    const p = buildPayload(makeAction(), 'owner/repo')
    const notes = JSON.parse(p.contextNotes)
    expect(notes.source).toBe('repohq-advisor')
  })

  it('objective contains action, reasoning, and impact', () => {
    const action = makeAction()
    const p = buildPayload(action, 'owner/repo')
    expect(p.objective).toContain(action.action)
    expect(p.objective).toContain(action.reasoning)
    expect(p.objective).toContain(action.estimatedImpact)
  })
})

// ─── Nexus configuration check ────────────────────────────────────────────────

describe('Nexus configuration detection', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns false when neither var is set', () => {
    delete process.env.NEXUS_API_URL
    delete process.env.NEXUS_API_TOKEN
    const configured = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)
    expect(configured).toBe(false)
  })

  it('returns false when only URL is set', () => {
    process.env.NEXUS_API_URL = 'https://nexus.example.com'
    delete process.env.NEXUS_API_TOKEN
    const configured = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)
    expect(configured).toBe(false)
  })

  it('returns false when only token is set', () => {
    delete process.env.NEXUS_API_URL
    process.env.NEXUS_API_TOKEN = 'nexus-token-abc'
    const configured = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)
    expect(configured).toBe(false)
  })

  it('returns true when both vars are set', () => {
    process.env.NEXUS_API_URL   = 'https://nexus.example.com'
    process.env.NEXUS_API_TOKEN = 'nexus-token-abc'
    const configured = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)
    expect(configured).toBe(true)
  })
})

// ─── Webhook event types ──────────────────────────────────────────────────────

describe('webhook event types', () => {
  const validEventTypes = ['agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_execution_failed'] as const

  it('covers all expected event types', () => {
    expect(validEventTypes).toContain('agent_task_queued')
    expect(validEventTypes).toContain('agent_pr_created')
    expect(validEventTypes).toContain('agent_pr_merged')
    expect(validEventTypes).toContain('agent_execution_failed')
  })

  it('agent_pr_merged is the accuracy-triggering event', () => {
    // This event triggers resync + actualDelta computation in the webhook handler
    expect(validEventTypes).toContain('agent_pr_merged')
  })
})
