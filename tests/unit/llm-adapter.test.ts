import { describe, it, expect } from 'vitest'
import {
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  PROVIDER_KEY_HINTS,
} from '@/lib/ai/providers'
import type { LLMProvider } from '@/lib/ai/providers'

const ALL_PROVIDERS: LLMProvider[] = ['anthropic', 'openai', 'gemini']

describe('PROVIDER_LABELS', () => {
  it('has a label for every provider', () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_LABELS[p]).toBeTruthy()
    }
  })

  it('contains expected display names', () => {
    expect(PROVIDER_LABELS.anthropic).toContain('Anthropic')
    expect(PROVIDER_LABELS.openai).toContain('OpenAI')
    expect(PROVIDER_LABELS.gemini).toContain('Google')
  })
})

describe('PROVIDER_MODELS', () => {
  it('has fast and capable model for every provider', () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_MODELS[p].fast).toBeTruthy()
      expect(PROVIDER_MODELS[p].capable).toBeTruthy()
    }
  })

  it('fast and capable models are different', () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_MODELS[p].fast).not.toBe(PROVIDER_MODELS[p].capable)
    }
  })

  it('Anthropic uses Claude model names', () => {
    expect(PROVIDER_MODELS.anthropic.fast).toContain('claude')
    expect(PROVIDER_MODELS.anthropic.capable).toContain('claude')
  })

  it('OpenAI uses GPT model names', () => {
    expect(PROVIDER_MODELS.openai.fast).toContain('gpt')
    expect(PROVIDER_MODELS.openai.capable).toContain('gpt')
  })

  it('Gemini uses gemini model names', () => {
    expect(PROVIDER_MODELS.gemini.fast).toContain('gemini')
    expect(PROVIDER_MODELS.gemini.capable).toContain('gemini')
  })
})

describe('PROVIDER_KEY_HINTS', () => {
  it('has a key hint for every provider', () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_KEY_HINTS[p]).toBeTruthy()
    }
  })

  it('Anthropic hint starts with sk-ant', () => {
    expect(PROVIDER_KEY_HINTS.anthropic).toContain('sk-ant')
  })

  it('OpenAI hint starts with sk-', () => {
    expect(PROVIDER_KEY_HINTS.openai).toContain('sk-')
  })

  it('Gemini hint starts with AIza', () => {
    expect(PROVIDER_KEY_HINTS.gemini).toContain('AIza')
  })
})

describe('provider coverage', () => {
  it('all three providers are defined in all maps', () => {
    for (const p of ALL_PROVIDERS) {
      expect(p in PROVIDER_LABELS).toBe(true)
      expect(p in PROVIDER_MODELS).toBe(true)
      expect(p in PROVIDER_KEY_HINTS).toBe(true)
    }
  })
})
