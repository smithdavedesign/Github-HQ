import { describe, it, expect } from 'vitest'
import { advisedTier, advisorReady, ideaEngineOrder, parseRating, rateTask, ratingPrompt, scoreAdvice, type TierAdviceEntry } from '../../factory/lib/tier-advisor'
import { capabilityStatus } from '../../factory/lib/ladder'
import type { LedgerEntry } from '../../factory/lib/ledger'

const cfg = { litellm: { url: 'http://x', key: 'k' }, advisor: { model: 'local-qwen3', timeoutMs: 1000 } }
const reply = (content: string, ok = true) => (async () => ({ ok, json: async () => ({ choices: [{ message: { content } }] }) })) as unknown as typeof fetch

describe('tier advisor: rating', () => {
  it('reads JSON, JSON with thinking, and the loose "tier: n" form; rejects anything else', () => {
    expect(parseRating('{"tier": 3, "reason": "spans many files"}')).toEqual({ difficulty: 3, reason: 'spans many files' })
    expect(parseRating('<think>hmm {"tier": 1}</think>Answer: {"tier": 2, "reason": "a bug"}')).toEqual({ difficulty: 2, reason: 'a bug' })
    expect(parseRating('Tier: 1 — mechanical')?.difficulty).toBe(1)
    expect(parseRating('{"tier": 5}')).toBe(null)
    expect(parseRating('no idea')).toBe(null)
  })
  it('asks the local model, and falls back to the kind\'s usual difficulty when it can\'t answer', async () => {
    expect(await rateTask(cfg, { kind: 'fix-lint', title: 't', objective: 'o' }, reply('{"tier":1,"reason":"mechanical"}')))
      .toEqual({ difficulty: 1, reason: 'mechanical', source: 'model', model: 'local-qwen3' })
    expect(await rateTask(cfg, { kind: 'idea-milestone', title: 't', objective: 'o' }, reply('gibberish'))).toMatchObject({ difficulty: 3, source: 'rule' })
    expect(await rateTask(cfg, { kind: 'fix-tests', title: 't', objective: 'o' }, reply('', false))).toMatchObject({ difficulty: 2, source: 'rule' })
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    expect((await rateTask(cfg, { kind: 'unknown-kind', title: 't', objective: 'o' }, boom)).difficulty).toBe(2)
  })
  it('the prompt carries the scale, the task and its files', () => {
    const p = ratingPrompt({ kind: 'owner-requested', title: 'Add CSV export', objective: 'export expenses', files: ['a.ts', 'b.ts'], repo: 'o/r' })
    expect(p).toMatch(/1 = routine/)
    expect(p).toMatch(/3 = advanced/)
    expect(p).toMatch(/Title: Add CSV export/)
    expect(p).toMatch(/Files in scope \(2\): a\.ts, b\.ts/)
  })
})

describe('tier advisor: routing', () => {
  it('maps difficulty to a starting tier within what the task is allowed', () => {
    expect(advisedTier(1, ['M0', 'M1', 'MC', 'M2'])).toBe('M0')
    expect(advisedTier(2, ['M0', 'M1', 'MC', 'M2'])).toBe('M1')
    expect(advisedTier(3, ['M0', 'M1', 'MC', 'M2'])).toBe('MC')
    expect(advisedTier(3, ['M0', 'M1', 'M2'])).toBe('M2')        // no Copilot left
    expect(advisedTier(2, ['M0', 'M2'])).toBe('M0')              // private repo: no free cloud
    expect(advisedTier(1, [])).toBe(null)
  })
  it('idea builds stay Claude first; only an acting advisor starts a routine milestone on the free pool', () => {
    expect(ideaEngineOrder(3, 'act')).toEqual(['claude', 'free'])
    expect(ideaEngineOrder(1, 'report')).toEqual(['claude', 'free'])
    expect(ideaEngineOrder(1, 'act')).toEqual(['free', 'claude'])
    expect(ideaEngineOrder(null, 'act')).toEqual(['claude', 'free'])
  })
})

describe('tier advisor: evidence and promotion', () => {
  const advice = (runId: string, advisedTier: 'M0' | 'M1' | 'MC' | 'M2'): TierAdviceEntry => ({
    type: 'tier_advice', at: '2026-10-10T00:00:00Z', runId, repo: 'o/r', kind: 'fix-lint', title: 't', difficulty: 1, source: 'model', reason: '', advisedTier, routedTier: 'M0', acted: false,
  })
  const att = (runId: string, tier: 'M0' | 'M1' | 'MC' | 'M2', outcome: 'verified' | 'failed') => ({
    type: 'attempt', id: `${runId}-${tier}`, runId, at: '2026-10-10T00:00:00Z', repo: 'o/r', kind: 'fix-lint', taskTier: 1, tier, model: 'm', harness: 'h', outcome, reason: '', exploring: false, durationMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0,
  }) as LedgerEntry
  it('scores advice against the lowest tier that produced a verified fix in the same run', () => {
    const entries: LedgerEntry[] = [
      advice('r1', 'M0'), att('r1', 'M0', 'verified'),                         // exact
      advice('r2', 'M1'), att('r2', 'M0', 'verified'),                         // too high
      advice('r3', 'M0'), att('r3', 'M0', 'failed'), att('r3', 'M1', 'verified'), // too low
      advice('r4', 'M1'), att('r4', 'M1', 'failed'),                           // nothing verified: not judged
    ]
    expect(scoreAdvice(entries)).toEqual({ judged: 3, exact: 1, tooHigh: 1, tooLow: 1 })
  })
  it('promotes on enough safe, mostly exact ratings; demotes when it rates too low', () => {
    expect(advisorReady({ judged: 9, exact: 9, tooHigh: 0, tooLow: 0 })).toBe('hold')
    expect(advisorReady({ judged: 10, exact: 6, tooHigh: 2, tooLow: 2 })).toBe('promote')
    expect(advisorReady({ judged: 10, exact: 4, tooHigh: 5, tooLow: 1 })).toBe('hold') // safe but rarely exact
    expect(advisorReady({ judged: 10, exact: 5, tooHigh: 1, tooLow: 4 })).toBe('demote')
  })
  it('shows up on the promotion ladder with its evidence', () => {
    const entries: LedgerEntry[] = Array.from({ length: 10 }, (_, i) => [advice(`r${i}`, 'M0'), att(`r${i}`, 'M0', 'verified')]).flat()
    const s = capabilityStatus('tier-advisor', 'report', entries, new Date('2026-10-12T00:00:00Z'))
    expect(s.advice).toBe('promote')
    expect(s.evidence).toMatch(/10 rated tasks judged: 10 exact/)
    expect(capabilityStatus('tier-advisor', 'report', [], new Date()).evidence).toMatch(/no rated task/)
  })
})
