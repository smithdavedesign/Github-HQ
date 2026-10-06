import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAX_AUTONOMOUS_RETRIES,
  AUTONOMOUS_TERMINAL_REASONS,
  isTerminalStage,
  isRetryEligible,
  shouldContinueAutonomousLoop,
} from '../../src/lib/agents/lifecycle-utils'

describe('loop policy', () => {
  it('treats terminal stages as non-retryable', () => {
    expect(isTerminalStage('merged')).toBe(true)
    expect(isTerminalStage('failed')).toBe(true)
    expect(isTerminalStage('needs_human')).toBe(true)
    expect(isTerminalStage('awaiting_approval')).toBe(true)
    expect(isTerminalStage('running')).toBe(false)
  })

  it('enforces the default retry budget', () => {
    expect(DEFAULT_MAX_AUTONOMOUS_RETRIES).toBe(3)
    expect(isRetryEligible(0, DEFAULT_MAX_AUTONOMOUS_RETRIES)).toBe(true)
    expect(isRetryEligible(2, DEFAULT_MAX_AUTONOMOUS_RETRIES)).toBe(true)
    expect(isRetryEligible(3, DEFAULT_MAX_AUTONOMOUS_RETRIES)).toBe(false)
  })

  it('stops continuation on terminal reasons and retry exhaustion', () => {
    expect(AUTONOMOUS_TERMINAL_REASONS).toContain('merged')
    expect(shouldContinueAutonomousLoop({
      retryCount: 2,
      maxAttempts: 3,
      lifecycleStage: 'running',
      stopReason: 'running',
      autoDispatchEnabled: true,
    })).toBe(true)

    expect(shouldContinueAutonomousLoop({
      retryCount: 3,
      maxAttempts: 3,
      lifecycleStage: 'running',
      stopReason: 'running',
      autoDispatchEnabled: true,
    })).toBe(false)

    expect(shouldContinueAutonomousLoop({
      retryCount: 1,
      maxAttempts: 3,
      lifecycleStage: 'running',
      stopReason: 'merged',
      autoDispatchEnabled: true,
    })).toBe(false)
  })
})
