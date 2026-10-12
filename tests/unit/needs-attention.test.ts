import { describe, it, expect } from 'vitest'
import { needsAttention, type AttentionInput } from '../../src/lib/agents/needs-attention'
import type { AccuracyStat } from '../../src/lib/actions/advisor-accuracy-utils'

const now = new Date('2026-10-12T02:00:00Z')
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)
const acc = (over: Partial<AccuracyStat> = {}): AccuracyStat => ({ impactType: 'revenue', successRate: 0, dataPoints: 0, avgActualDelta: 0, hasSignal: false, timeDecayedRate: 0, executionFailures: 0, ...over })
const base: AttentionInput = { failing: [], pipeline: { tickAt: minutesAgo(5), ok: true, errors: [] }, claude: null, copilot: null, accuracy: [acc()], now }

describe('needsAttention', () => {
  it('all clear gives nothing', () => {
    expect(needsAttention(base)).toEqual([])
  })

  it('failing checks come first, capped at 5 plus a count', () => {
    const failing = Array.from({ length: 7 }, (_, i) => ({ system: 'ai-stack', component: `c${i}`, event: 'check', message: `m${i}` }))
    const items = needsAttention({ ...base, failing })
    expect(items).toHaveLength(6)
    expect(items[0]).toEqual({ tone: 'fail', text: 'ai-stack/c0: m0', href: '#system-log' })
    expect(items[5].text).toBe('…and 2 more failing checks')
  })

  it('pipeline errors and a stalled pipeline', () => {
    const items = needsAttention({ ...base, pipeline: { tickAt: minutesAgo(180), ok: false, errors: ['notion sync failed', 'x'] } })
    expect(items.map(i => i.text)).toEqual(['Idea pipeline: notion sync failed (+1 more)', "Idea pipeline hasn't ticked for 3h (it runs every 15 min)"])
  })

  it('Copilot used up, and a recent Claude capacity hit', () => {
    const copilot = { at: now, installed: true, plan: 'pro', percentRemaining: 0, overagePermitted: false, resetDate: '2026-11-01', tasksToday: 0, maxTasksPerDay: 8, reviewsToday: 0, maxReviewsPerDay: 8, stale: false }
    const claude = { day: {} as never, week: {} as never, lastCapacity: { at: minutesAgo(60), message: '5-hour limit reached' } }
    const texts = needsAttention({ ...base, copilot, claude }).map(i => i.text)
    expect(texts).toContain('Claude subscription hit its limit: 5-hour limit reached')
    expect(texts).toContain('Copilot premium requests used up until 2026-11-01: the Copilot builder is paused and reviews fall back to the local reviewer')
  })

  it('accuracy note only when there are failed runs but nothing measured', () => {
    expect(needsAttention({ ...base, accuracy: [acc({ executionFailures: 8 }), acc({ impactType: 'health', executionFailures: 2 })] })).toEqual([
      { tone: 'info', text: "Advisor accuracy: no merged PR has a measured health change yet (10 failed runs aren't counted against the advice)", href: '#advisor-accuracy' },
    ])
    expect(needsAttention({ ...base, accuracy: [acc({ executionFailures: 8, dataPoints: 3 })] })).toEqual([])
  })
})

describe('needsAttention: long failures', () => {
  it('shows a one-line summary and keeps the full message for hover', () => {
    const message = 'build tiebreak MVP: sandbox patch: git add failed: ignored paths:\nnode_modules\nhint: Use -f if you really want to add them.'
    const [item] = needsAttention({ failing: [{ system: 'idea-factory', component: 'pipeline', event: 'tick', message }], pipeline: null, claude: null, copilot: null, accuracy: [], now: new Date() })
    expect(item.text).toBe('idea-factory/pipeline: build tiebreak MVP: sandbox patch: git add failed: ignored paths: node_modules')
    expect(item.detail).toBe(message)
  })
})
