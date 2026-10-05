import { describe, it, expect, vi } from 'vitest'
import { extractJson, generateJson } from '../../src/lib/ai/structured'
import type { LLMAdapter, GenerateParams } from '../../src/lib/ai/adapter'

function scripted(provider: LLMAdapter['provider'], replies: string[]): LLMAdapter & { calls: GenerateParams[] } {
  const calls: GenerateParams[] = []
  return {
    provider,
    calls,
    generate: vi.fn(async (p: GenerateParams) => {
      calls.push(p)
      const next = replies.shift()
      if (next === undefined) throw new Error('no scripted reply left')
      return next
    }),
  }
}

const PARAMS: GenerateParams = { system: 'sys', user: 'give json' }

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('strips <think> reasoning blocks from reasoning models', () => {
    expect(extractJson('<think>let me {think}</think>\n{"ok":true}')).toEqual({ ok: true })
  })
  it('finds JSON embedded in prose', () => {
    expect(extractJson('Sure! Here it is:\n{"items":[1,2]}\nHope that helps.')).toEqual({ items: [1, 2] })
  })
  it('handles braces inside strings', () => {
    expect(extractJson('note: {"text":"a } tricky { string"} done')).toEqual({ text: 'a } tricky { string' })
  })
  it('parses top-level arrays', () => {
    expect(extractJson('result: [{"x":1}]')).toEqual([{ x: 1 }])
  })
  it('throws when there is no JSON', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/no JSON/)
  })
})

describe('generateJson', () => {
  it('returns on the first valid reply', async () => {
    const a = scripted('openrouter', ['{"a":1}'])
    const r = await generateJson(a, PARAMS)
    expect(r).toEqual({ value: { a: 1 }, attempts: 1, usedFallback: false })
  })

  it('repairs once with the validation error in the prompt', async () => {
    const a = scripted('openrouter', ['not json at all', '{"a":2}'])
    const r = await generateJson(a, PARAMS)
    expect(r.attempts).toBe(2)
    expect(a.calls[1].user).toContain('could not be used')
    expect(a.calls[1].user).toContain('give json')
  })

  it('applies the validator and repairs on schema errors', async () => {
    const validate = (v: unknown) => {
      const o = v as { items?: unknown }
      if (!Array.isArray(o.items)) throw new Error('items must be an array')
      return o as { items: unknown[] }
    }
    const a = scripted('openrouter', ['{"items":"nope"}', '{"items":[]}'])
    const r = await generateJson(a, PARAMS, { validate })
    expect(r.value.items).toEqual([])
    expect(a.calls[1].user).toContain('items must be an array')
  })

  it('falls back to the fallback adapter (fast model) after repair fails', async () => {
    const a = scripted('openrouter', ['nope', 'still nope'])
    const fb = scripted('anthropic', ['{"from":"haiku"}'])
    const r = await generateJson(a, PARAMS, { fallback: fb })
    expect(r).toEqual({ value: { from: 'haiku' }, attempts: 3, usedFallback: true })
    expect(fb.calls[0].fast).toBe(true)
  })

  it('falls back immediately when the provider itself errors (quota / overload)', async () => {
    const failing: LLMAdapter = { provider: 'gemini', generate: vi.fn(async () => { throw new Error('503 UNAVAILABLE: high demand') }) }
    const fb = scripted('anthropic', ['{"ok":true}'])
    const r = await generateJson(failing, PARAMS, { fallback: fb })
    expect(r).toEqual({ value: { ok: true }, attempts: 3, usedFallback: true })
  })

  it('rethrows provider errors when there is no fallback', async () => {
    const failing: LLMAdapter = { provider: 'gemini', generate: vi.fn(async () => { throw new Error('429') }) }
    await expect(generateJson(failing, PARAMS)).rejects.toThrow('429')
  })

  it('throws when repair fails and there is no fallback', async () => {
    const a = scripted('openrouter', ['nope', 'still nope'])
    await expect(generateJson(a, PARAMS, { fallback: null })).rejects.toThrow()
  })
})
