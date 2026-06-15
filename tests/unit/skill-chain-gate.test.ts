/**
 * Tests the "don't chain (or self-improve) for no reason" gate in
 * /api/webhooks/agent-events/route.ts. Mirrors the gating condition using the
 * real getActionableFindings/isGstackSkill so this stays in sync with
 * src/lib/skills/suggest-actions.ts.
 */
import { describe, it, expect } from 'vitest'
import { getActionableFindings } from '../../src/lib/skills/suggest-actions'
import { isGstackSkill } from '../../src/lib/actions/nexus-utils'

/** Mirrors the 1-hop skill-chain auto-queue gate in route.ts. */
function shouldAutoChain(isChained: boolean, suggestedNextSkill: string | undefined, findings: string[]): boolean {
  if (isChained || !suggestedNextSkill || !isGstackSkill(suggestedNextSkill)) return false
  return getActionableFindings(findings).length > 0
}

/** Mirrors the gstack-self-scan "Fix: <finding>" queueing gate in route.ts. */
function shouldQueueSelfImproveTasks(isSelfScan: boolean, repoId: number | null, findings: string[]): boolean {
  return isSelfScan && repoId != null && getActionableFindings(findings).length > 0
}

const INFORMATIONAL_FINDING =
  'TypeScript: N/A — project is plain JavaScript. No tsconfig.json and zero .ts/.tsx files in client or server, so there is no compile-time type checking configured. (Cannot report TS errors because TS is not configured)'

describe('skill-chain auto-queue gate', () => {
  it('does not chain when the only finding is informational (TypeScript: N/A)', () => {
    expect(shouldAutoChain(false, 'ship', [INFORMATIONAL_FINDING])).toBe(false)
  })

  it('does not chain when findings are empty', () => {
    expect(shouldAutoChain(false, 'ship', [])).toBe(false)
  })

  it('does not chain when all findings are passing (✅)', () => {
    expect(shouldAutoChain(false, 'ship', ['✅ Tests: 423/423 passing'])).toBe(false)
  })

  it('chains when there is at least one actionable finding', () => {
    expect(shouldAutoChain(false, 'ship', ['Dead code: 3 unused exports'])).toBe(true)
  })

  it('chains when an actionable finding is mixed with an informational one', () => {
    expect(shouldAutoChain(false, 'ship', [INFORMATIONAL_FINDING, 'Dead code: 3 unused exports'])).toBe(true)
  })

  it('does not chain when already a chained task (chainDepth guard)', () => {
    expect(shouldAutoChain(true, 'ship', ['Dead code: 3 unused exports'])).toBe(false)
  })

  it('does not chain when suggestedNextSkill is missing', () => {
    expect(shouldAutoChain(false, undefined, ['Dead code: 3 unused exports'])).toBe(false)
  })

  it('does not chain when suggestedNextSkill is not a valid gstack skill', () => {
    expect(shouldAutoChain(false, 'not-a-skill', ['Dead code: 3 unused exports'])).toBe(false)
  })
})

describe('gstack-self-scan self-improve queueing gate', () => {
  it('does not queue fix tasks when the only finding is informational', () => {
    expect(shouldQueueSelfImproveTasks(true, 1, [INFORMATIONAL_FINDING])).toBe(false)
  })

  it('does not queue fix tasks for non-self-scan reports', () => {
    expect(shouldQueueSelfImproveTasks(false, 1, ['Dead code: 3 unused exports'])).toBe(false)
  })

  it('queues fix tasks when there is at least one actionable finding', () => {
    expect(shouldQueueSelfImproveTasks(true, 1, ['Dead code: 3 unused exports'])).toBe(true)
  })
})
