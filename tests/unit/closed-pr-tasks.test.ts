import { describe, expect, it } from 'vitest'
import { closedPrTaskIds } from '@/lib/agents/lifecycle-utils'

describe('closedPrTaskIds', () => {
  it('a PR merged or closed without merging no longer holds its repo', () => {
    const ids = closedPrTaskIds([
      { eventType: 'agent_pr_created', metadata: { taskId: 'open', prUrl: 'u1' } },
      { eventType: 'agent_pr_merged', metadata: { taskId: 'merged' } },
      { eventType: 'agent_pr_rejected', metadata: { taskId: 'closed' } },
      { eventType: 'agent_ci_failed', metadata: { taskId: 'open' } },
      { eventType: 'agent_pr_rejected', metadata: null },
    ])
    expect([...ids].sort()).toEqual(['closed', 'merged'])
  })
})
