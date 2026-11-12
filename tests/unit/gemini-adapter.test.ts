/**
 * The Gemini adapter turns thinking off (thinking tokens count against maxOutputTokens and cut the
 * digest's JSON off), and falls back to default thinking plus headroom for models that refuse that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { query: { users: { findFirst: async () => undefined } } } }))
const { getLLMAdapter } = await import('@/lib/ai/adapter')

type Body = { generationConfig: { maxOutputTokens: number; thinkingConfig?: { thinkingBudget: number } } }

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_ALLOW_PAID', 'GEMINI_MODEL_FAST', 'GEMINI_MODEL_CAPABLE'] as const
const saved: Record<string, string | undefined> = {}
let bodies: Array<{ model: string; body: Body }> = []

const ok = (parts: Array<{ text?: string; thought?: boolean }>) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts } }] }), { status: 200 })
const bad = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 })

function mockFetch(reply: (model: string, body: Body) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    const model = /models\/([^:]+):/.exec(url)![1]
    const body = JSON.parse(init.body) as Body
    bodies.push({ model, body })
    return reply(model, body)
  }))
}

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.GEMINI_API_KEY = 'test-key'
  bodies = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('Gemini adapter', () => {
  it('asks for thinking off with the caller\'s token limit', async () => {
    process.env.GEMINI_MODEL_CAPABLE = 'test-flash'
    mockFetch(() => ok([{ text: '{"a":1}' }]))
    const adapter = await getLLMAdapter('u1')
    expect(adapter.provider).toBe('gemini')
    expect(await adapter.generate({ system: 's', user: 'u', maxTokens: 1024 })).toBe('{"a":1}')
    expect(bodies).toHaveLength(1)
    expect(bodies[0].body.generationConfig).toEqual({ maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } })
  })

  it('retries without thinkingConfig and with headroom when the model refuses, and remembers it', async () => {
    process.env.GEMINI_MODEL_CAPABLE = 'test-pro'
    mockFetch((_m, body) => body.generationConfig.thinkingConfig
      ? bad('Budget 0 is invalid. This model only works in thinking mode.')
      : ok([{ text: '{"b":2}' }]))
    const adapter = await getLLMAdapter('u1')
    expect(await adapter.generate({ system: 's', user: 'u', maxTokens: 1000 })).toBe('{"b":2}')
    expect(bodies.map(b => b.body.generationConfig)).toEqual([
      { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
      { maxOutputTokens: 1000 + 4096 },
    ])
    bodies = []
    expect(await adapter.generate({ system: 's', user: 'u', maxTokens: 1000 })).toBe('{"b":2}')
    expect(bodies.map(b => b.body.generationConfig)).toEqual([{ maxOutputTokens: 1000 + 4096 }])
  })

  it('still throws the API error when the retry fails too', async () => {
    process.env.GEMINI_MODEL_CAPABLE = 'test-broken'
    mockFetch(() => bad('Request contains an invalid argument.'))
    const adapter = await getLLMAdapter('u1')
    await expect(adapter.generate({ system: 's', user: 'u' })).rejects.toThrow('Request contains an invalid argument.')
    expect(bodies).toHaveLength(2)
  })

  it('joins the answer\'s text parts and skips thought parts', async () => {
    process.env.GEMINI_MODEL_CAPABLE = 'test-parts'
    mockFetch(() => ok([{ text: 'thinking about it', thought: true }, { text: '{"c":' }, { text: '3}' }]))
    const adapter = await getLLMAdapter('u1')
    expect(await adapter.generate({ system: 's', user: 'u' })).toBe('{"c":3}')
  })
})
