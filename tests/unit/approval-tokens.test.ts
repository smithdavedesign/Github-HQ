import { describe, expect, it } from 'vitest'

import { consumeApprovalToken, issueApprovalToken } from '../../src/lib/approval-tokens'

describe('approval tokens', () => {
  it('issues a single-use approval token and consumes it once', () => {
    const token = issueApprovalToken({
      taskId: 'task-123',
      repo: 'acme/example',
      action: 'approve M2 lane',
      reason: 'Budget exceeded',
    }, {
      expiresInMs: 60_000,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(consumeApprovalToken(token, { now: new Date('2026-01-01T00:00:10.000Z') })).toMatchObject({
      taskId: 'task-123',
      repo: 'acme/example',
      action: 'approve M2 lane',
      reason: 'Budget exceeded',
    })

    expect(() => consumeApprovalToken(token, { now: new Date('2026-01-01T00:00:20.000Z') })).toThrow(/used|expired|invalid/i)
  })

  it('rejects expired approval tokens', () => {
    const token = issueApprovalToken({
      taskId: 'task-456',
      repo: 'acme/demo',
      action: 'approve budget increase',
    }, {
      expiresInMs: 100,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(() => consumeApprovalToken(token, { now: new Date('2026-01-01T00:02:00.000Z') })).toThrow(/expired/i)
  })
})
