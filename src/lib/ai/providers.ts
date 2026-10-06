export type LLMProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter'

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai:    'GPT-4o (OpenAI)',
  gemini:    'Gemini (Google)',
  openrouter: 'OpenRouter (free models)',
}

/** Short name for use in buttons and inline UI ("Analyze with Claude") */
export const PROVIDER_SHORT_NAME: Record<LLMProvider, string> = {
  anthropic: 'Claude',
  openai:    'GPT-4o',
  gemini:    'Gemini',
  openrouter: 'OpenRouter',
}

export const PROVIDER_MODELS: Record<LLMProvider, { fast: string; capable: string }> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', capable: 'claude-sonnet-4-6' },
  openai:    { fast: 'gpt-4o-mini',               capable: 'gpt-4o' },
  // Stable "-latest" pointers track Google's current Flash models (versioned ids get retired:
  // gemini-2.0-flash and gemini-1.5-pro now 404). Pro has no free-tier quota. Override with
  // GEMINI_MODEL_FAST / GEMINI_MODEL_CAPABLE.
  gemini:    { fast: 'gemini-flash-lite-latest',   capable: 'gemini-flash-latest' },
  // Free slugs rotate — override with OPENROUTER_MODEL_FAST / OPENROUTER_MODEL_CAPABLE.
  // `openrouter/free` is OpenRouter's router across currently-free models.
  openrouter: { fast: 'openrouter/free',          capable: 'nvidia/nemotron-3-super-120b-a12b:free' },
}

export const PROVIDER_KEY_HINTS: Record<LLMProvider, string> = {
  anthropic: 'sk-ant-...',
  openai:    'sk-...',
  gemini:    'AIza...',
  openrouter: 'sk-or-...',
}
