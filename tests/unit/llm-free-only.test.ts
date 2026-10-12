/**
 * RepoHQ's own AI runs at $0: Claude and GPT-4o (billed per call) only with LLM_ALLOW_PAID=1,
 * otherwise the first free provider with a key, and a fallback that never reaches for Anthropic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseProvider, isPaidProvider, paidAllowed, NO_FREE_PROVIDER, type LLMProvider } from '@/lib/ai/providers'

let user: { llmProvider: string | null; llmKeys: Record<string, string> | null; llmApiKey: string | null } | undefined
vi.mock('@/lib/db', () => ({ db: { query: { users: { findFirst: async () => user } } } }))
const { getLLMAdapter, getFallbackAdapter } = await import('@/lib/ai/adapter')

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_ALLOW_PAID'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

describe('chooseProvider', () => {
  const has = (...ps: LLMProvider[]) => (p: LLMProvider) => ps.includes(p)
  it('keeps a free choice that has a key', () => {
    expect(chooseProvider('gemini', has('gemini', 'openrouter'), false)).toBe('gemini')
  })
  it('swaps a paid choice for the first free provider with a key while paid is off', () => {
    expect(chooseProvider('anthropic', has('anthropic', 'gemini'), false)).toBe('gemini')
    expect(chooseProvider('anthropic', has('anthropic', 'openrouter', 'gemini'), false)).toBe('openrouter')
  })
  it('keeps a paid choice when paid is allowed', () => {
    expect(chooseProvider('anthropic', has('anthropic', 'openrouter'), true)).toBe('anthropic')
  })
  it('falls through a free choice without a key, and is null when nothing free has one', () => {
    expect(chooseProvider('openrouter', has('gemini'), false)).toBe('gemini')
    expect(chooseProvider('anthropic', has('anthropic', 'openai'), false)).toBeNull()
  })
  it('knows which providers bill, and paid is off unless LLM_ALLOW_PAID=1', () => {
    expect(['anthropic', 'openai'].every(p => isPaidProvider(p as LLMProvider))).toBe(true)
    expect(['openrouter', 'gemini'].some(p => isPaidProvider(p as LLMProvider))).toBe(false)
    expect(paidAllowed({})).toBe(false)
    expect(paidAllowed({ LLM_ALLOW_PAID: 'true' })).toBe(false)
    expect(paidAllowed({ LLM_ALLOW_PAID: '1' })).toBe(true)
  })
})

describe('getLLMAdapter', () => {
  it('a user who chose Claude gets their free key instead while paid is off', async () => {
    process.env.ANTHROPIC_API_KEY = 'server-anthropic'
    user = { llmProvider: 'anthropic', llmKeys: { gemini: 'user-gemini' }, llmApiKey: null }
    expect((await getLLMAdapter('u')).provider).toBe('gemini')
  })
  it('uses the server\'s free key when the user has none', async () => {
    process.env.ANTHROPIC_API_KEY = 'server-anthropic'
    process.env.OPENROUTER_API_KEY = 'server-openrouter'
    user = { llmProvider: 'anthropic', llmKeys: null, llmApiKey: null }
    expect((await getLLMAdapter('u')).provider).toBe('openrouter')
  })
  it('says what to set up rather than spending when only paid keys exist', async () => {
    process.env.ANTHROPIC_API_KEY = 'server-anthropic'
    user = { llmProvider: 'anthropic', llmKeys: { openai: 'user-openai' }, llmApiKey: null }
    await expect(getLLMAdapter('u')).rejects.toThrow(NO_FREE_PROVIDER)
  })
  it('runs Claude when paid is allowed', async () => {
    process.env.LLM_ALLOW_PAID = '1'
    process.env.ANTHROPIC_API_KEY = 'server-anthropic'
    user = { llmProvider: 'anthropic', llmKeys: null, llmApiKey: null }
    expect((await getLLMAdapter('u')).provider).toBe('anthropic')
  })
})

describe('getFallbackAdapter', () => {
  it('tries the other free provider, never Anthropic while paid is off', () => {
    process.env.ANTHROPIC_API_KEY = 'server-anthropic'
    expect(getFallbackAdapter('openrouter')).toBeNull()
    process.env.GEMINI_API_KEY = 'server-gemini'
    expect(getFallbackAdapter('openrouter')?.provider).toBe('gemini')
    expect(getFallbackAdapter('gemini')).toBeNull()
  })
  it('may use Claude Haiku when paid is allowed', () => {
    process.env.LLM_ALLOW_PAID = '1'
    process.env.ANTHROPIC_API_KEY = 'server-anthropic'
    expect(getFallbackAdapter('openrouter')?.provider).toBe('anthropic')
  })
})
