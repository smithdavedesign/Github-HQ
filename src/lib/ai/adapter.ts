import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type LLMProvider = 'anthropic' | 'openai'

export interface GenerateParams {
  system: string
  user: string
  fast?: boolean        // true = haiku / gpt-4o-mini  false = sonnet / gpt-4o
  maxTokens?: number
  cacheSystem?: boolean // prompt caching — Claude only, silently ignored for OpenAI
}

export interface LLMAdapter {
  provider: LLMProvider
  generate(params: GenerateParams): Promise<string>
}

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai:    'GPT-4o (OpenAI)',
}

export const PROVIDER_MODELS: Record<LLMProvider, { fast: string; capable: string }> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', capable: 'claude-sonnet-4-6' },
  openai:    { fast: 'gpt-4o-mini',               capable: 'gpt-4o' },
}

function createAnthropicAdapter(apiKey: string): LLMAdapter {
  const client = new Anthropic({ apiKey })
  return {
    provider: 'anthropic',
    async generate({ system, user, fast = false, maxTokens = 1000, cacheSystem = false }) {
      const model = fast
        ? PROVIDER_MODELS.anthropic.fast
        : PROVIDER_MODELS.anthropic.capable

      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: cacheSystem
          ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
          : system,
        messages: [{ role: 'user', content: user }],
      })
      return message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
    },
  }
}

function createOpenAIAdapter(apiKey: string): LLMAdapter {
  const client = new OpenAI({ apiKey })
  return {
    provider: 'openai',
    async generate({ system, user, fast = false, maxTokens = 1000 }) {
      const model = fast
        ? PROVIDER_MODELS.openai.fast
        : PROVIDER_MODELS.openai.capable

      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
      })
      return response.choices[0].message.content?.trim() ?? '{}'
    },
  }
}

/**
 * Get an LLM adapter for a user.
 * User's saved key takes priority; falls back to app-level env var.
 * Throws if no key is available for the selected provider.
 */
export async function getLLMAdapter(userId: string): Promise<LLMAdapter> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { llmProvider: true, llmApiKey: true },
  })

  const provider = (user?.llmProvider ?? 'anthropic') as LLMProvider
  const apiKey = user?.llmApiKey
    ?? (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : null)
    ?? null

  if (!apiKey) {
    throw new Error(
      `No API key for ${PROVIDER_LABELS[provider]}. Add one in Settings → AI Provider.`
    )
  }

  if (provider === 'openai') return createOpenAIAdapter(apiKey)
  return createAnthropicAdapter(apiKey)
}

/** Quick validation call — sends a minimal prompt to confirm the key works. */
export async function testLLMKey(provider: LLMProvider, apiKey: string): Promise<void> {
  const adapter = provider === 'openai'
    ? createOpenAIAdapter(apiKey)
    : createAnthropicAdapter(apiKey)

  await adapter.generate({ system: 'Reply with OK.', user: 'OK?', fast: true, maxTokens: 5 })
}
