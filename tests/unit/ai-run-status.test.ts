import { describe, it, expect } from 'vitest'
import { describeAiError } from '@/lib/ai/errors'
import { aiRunLine, type AiRunStatus } from '@/lib/ai/run-status'
import { NO_FREE_PROVIDER } from '@/lib/ai/providers'

describe('describeAiError', () => {
  it('names OpenRouter\'s free daily limit (what made the Advisor and CEO report seem to do nothing)', () => {
    const err = Object.assign(new Error('429 Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day'), { status: 429 })
    expect(describeAiError(err)).toMatch(/OpenRouter's free daily limit is used up .* resets at midnight UTC/)
  })
  it('names other rate limits, rejected keys, unusable answers, and the no-free-provider case', () => {
    expect(describeAiError(Object.assign(new Error('Too many requests'), { status: 429 }))).toMatch(/rate-limiting/)
    expect(describeAiError(new Error('RESOURCE_EXHAUSTED: quota'))).toMatch(/rate-limiting/)
    expect(describeAiError(Object.assign(new Error('Incorrect API key'), { status: 401 }))).toMatch(/rejected the key/)
    expect(describeAiError(new Error('Unexpected token < in JSON'))).toMatch(/wasn't usable/)
    expect(describeAiError(new Error(NO_FREE_PROVIDER))).toBe(NO_FREE_PROVIDER)
  })
})

describe('aiRunLine', () => {
  const now = new Date('2026-10-12T06:30:00Z')
  const run = (o: Partial<AiRunStatus>): AiRunStatus => ({ id: 'r', status: 'ok', error: null, startedAt: new Date('2026-10-12T06:24:00Z'), finishedAt: null, ...o })
  it('says it\'s generating while a run is going, and calls a run stuck past the function limit stopped', () => {
    expect(aiRunLine(run({ status: 'running', startedAt: new Date('2026-10-12T06:29:00Z') }), null, now)).toEqual({ tone: 'running', text: 'Generating…' })
    expect(aiRunLine(run({ status: 'running', startedAt: new Date('2026-10-12T06:00:00Z') }), null, now)?.tone).toBe('failed')
  })
  it('shows a failure since the last result, with its reason, and nothing for older failures or successes', () => {
    const failed = run({ status: 'failed', error: 'Advisor: OpenRouter\'s free daily limit is used up' })
    expect(aiRunLine(failed, new Date('2026-08-17T06:12:59Z'), now)).toEqual({ tone: 'failed', text: failed.error })
    expect(aiRunLine(failed, null, now)?.tone).toBe('failed')
    expect(aiRunLine(failed, new Date('2026-10-12T06:25:00Z'), now)).toBeNull()
    expect(aiRunLine(run({ status: 'ok' }), null, now)).toBeNull()
    expect(aiRunLine(null, null, now)).toBeNull()
  })
})
