import { describe, it, expect } from 'vitest'
import { PROVIDER_SHORT_NAME, PROVIDER_LABELS } from '../../src/lib/ai/providers'

describe('PROVIDER_SHORT_NAME', () => {
  it('maps anthropic to Claude', () => {
    expect(PROVIDER_SHORT_NAME.anthropic).toBe('Claude')
  })

  it('maps openai to GPT-4o', () => {
    expect(PROVIDER_SHORT_NAME.openai).toBe('GPT-4o')
  })

  it('maps gemini to Gemini', () => {
    expect(PROVIDER_SHORT_NAME.gemini).toBe('Gemini')
  })

  it('covers all providers in PROVIDER_LABELS', () => {
    for (const provider of Object.keys(PROVIDER_LABELS)) {
      expect(PROVIDER_SHORT_NAME).toHaveProperty(provider)
      expect((PROVIDER_SHORT_NAME as Record<string, string>)[provider].length).toBeGreaterThan(0)
    }
  })
})
