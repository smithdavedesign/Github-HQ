import { describe, it, expect } from 'vitest'
import { freshContent } from '../../src/lib/ai/fresh'
import { runWeeklyAi } from '../../src/lib/ai/weekly'
import { isTransientAiError } from '../../src/lib/ai/errors'

const NOW = new Date('2026-10-13T20:00:00Z')

describe("the dashboard's Advisor and CEO report", () => {
  it("are shown by their own date, not their digest row's (no digest from August to October hid every run)", () => {
    const august = new Date('2026-08-17T06:12:48Z')
    const fresh = { generatedAt: '2026-10-12T15:23:28Z', actions: [] }
    expect(freshContent(fresh, august, NOW)).toBe(fresh)
    expect(freshContent({ generatedAt: '2026-10-01T00:00:00Z' }, august, NOW)).toBeNull()
    // Content from before generatedAt was stored: the digest's date decides.
    expect(freshContent({}, new Date('2026-10-10T00:00:00Z'), NOW)).toEqual({})
    expect(freshContent({}, august, NOW)).toBeNull()
    expect(freshContent(null, august, NOW)).toBeNull()
  })
})

describe('the weekly AI run (digest cron)', () => {
  it('writes the digest first, then the Advisor, CEO report and distiller together', async () => {
    const order: string[] = []
    let digestDone = false
    const step = (name: string) => async () => { order.push(`${name}${name !== 'digest' && !digestDone ? ' (before the digest!)' : ''}`); if (name === 'digest') digestDone = true }
    expect(await runWeeklyAi('u1', { digest: step('digest'), advisor: step('advisor'), ceoReport: step('ceo'), distill: step('distill') })).toEqual([])
    expect(order).toEqual(['digest', 'advisor', 'ceo', 'distill'])
  })
  it("reports what failed, in words, instead of answering ok", async () => {
    const busy = async () => { throw new Error('Digest: This model is currently experiencing high demand. Please try again later.') }
    const quota = async () => { throw new Error('429 Rate limit exceeded: free-models-per-day') }
    const ok = async () => undefined
    const failed = await runWeeklyAi('u1', { digest: busy, advisor: quota, ceoReport: ok, distill: ok })
    expect(failed).toHaveLength(2)
    expect(failed[0]).toMatch(/^digest: Digest: This model is currently experiencing high demand/)
    expect(failed[1]).toMatch(/^Advisor: OpenRouter's free daily limit is used up/)
  })
  it('still runs the Advisor and CEO report when the digest fails', async () => {
    const ran: string[] = []
    await runWeeklyAi('u1', { digest: async () => { throw new Error('x') }, advisor: async () => { ran.push('advisor') }, ceoReport: async () => { ran.push('ceo') }, distill: async () => undefined })
    expect(ran).toEqual(['advisor', 'ceo'])
  })
})

describe('isTransientAiError', () => {
  it('a busy provider is worth one more try; a used-up daily quota or a rejected key is not', () => {
    expect(isTransientAiError(new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.'))).toBe(true)
    expect(isTransientAiError(new Error('503 UNAVAILABLE'))).toBe(true)
    expect(isTransientAiError(Object.assign(new Error('Provider returned error'), { status: 429 }))).toBe(true)
    expect(isTransientAiError(new Error('Request timed out'))).toBe(true)
    expect(isTransientAiError(new Error('429 Rate limit exceeded: free-models-per-day'))).toBe(false)
    expect(isTransientAiError(Object.assign(new Error('nope'), { status: 401 }))).toBe(false)
    expect(isTransientAiError(new Error("model returned non-JSON response"))).toBe(false)
  })
})
