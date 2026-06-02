export type LLMProvider = 'anthropic' | 'openai' | 'gemini'

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai:    'GPT-4o (OpenAI)',
  gemini:    'Gemini (Google)',
}

/** Short name for use in buttons and inline UI ("Analyze with Claude") */
export const PROVIDER_SHORT_NAME: Record<LLMProvider, string> = {
  anthropic: 'Claude',
  openai:    'GPT-4o',
  gemini:    'Gemini',
}

export const PROVIDER_MODELS: Record<LLMProvider, { fast: string; capable: string }> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', capable: 'claude-sonnet-4-6' },
  openai:    { fast: 'gpt-4o-mini',               capable: 'gpt-4o' },
  gemini:    { fast: 'gemini-2.0-flash',           capable: 'gemini-1.5-pro' },
}

export const PROVIDER_KEY_HINTS: Record<LLMProvider, string> = {
  anthropic: 'sk-ant-...',
  openai:    'sk-...',
  gemini:    'AIza...',
}
