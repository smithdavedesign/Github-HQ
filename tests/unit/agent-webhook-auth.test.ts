/**
 * Tests the fail-secure webhook secret validation logic.
 * Mirrors the fixed guard in /api/webhooks/agent-events/route.ts.
 */
import { describe, it, expect } from 'vitest'

/** Extracted logic from the webhook route — keep in sync with route.ts */
function isWebhookAuthorized(
  incomingSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret || incomingSecret !== expectedSecret) return false
  return true
}

describe('agent webhook secret validation (fail-secure)', () => {
  it('rejects when NEXUS_WEBHOOK_SECRET is not set (fail-secure)', () => {
    expect(isWebhookAuthorized('any-secret', undefined)).toBe(false)
  })

  it('rejects when NEXUS_WEBHOOK_SECRET is empty string (fail-secure)', () => {
    expect(isWebhookAuthorized('any-secret', '')).toBe(false)
  })

  it('accepts when secret matches', () => {
    expect(isWebhookAuthorized('correct-secret', 'correct-secret')).toBe(true)
  })

  it('rejects when secret is wrong', () => {
    expect(isWebhookAuthorized('wrong-secret', 'correct-secret')).toBe(false)
  })

  it('rejects when no secret header sent (null)', () => {
    expect(isWebhookAuthorized(null, 'correct-secret')).toBe(false)
  })

  it('rejects empty string header even if secret is set', () => {
    expect(isWebhookAuthorized('', 'correct-secret')).toBe(false)
  })
})
