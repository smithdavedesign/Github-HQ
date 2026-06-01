'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { testLLMKey } from '@/lib/ai/adapter'
import type { LLMProvider } from '@/lib/ai/adapter'

export async function getLLMSettings(): Promise<{
  provider: LLMProvider
  hasKey: boolean
  keySource: 'user' | 'env' | null
}> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { llmProvider: true, llmApiKey: true },
  })

  const provider = (user?.llmProvider ?? 'anthropic') as LLMProvider
  const hasUserKey = !!(user?.llmApiKey && user.llmApiKey.length > 0)
  const hasEnvKey  = (
    (provider === 'anthropic' && !!process.env.ANTHROPIC_API_KEY) ||
    (provider === 'openai'    && !!process.env.OPENAI_API_KEY) ||
    (provider === 'gemini'    && !!process.env.GEMINI_API_KEY)
  )

  return {
    provider,
    hasKey: hasUserKey || hasEnvKey,
    keySource: hasUserKey ? 'user' : hasEnvKey ? 'env' : null,
  }
}

export async function saveLLMSettings(provider: LLMProvider, apiKey: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Validate key before touching the DB — wrap in serializable error so
  // non-serializable SDK errors don't cause the "Server Components render" crash
  try {
    await testLLMKey(provider, apiKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Anthropic'} key invalid: ${msg.slice(0, 200)}`)
  }

  // .returning() surfaces silent failures (0 rows updated = user row not found)
  const [updated] = await db.update(users)
    .set({ llmProvider: provider, llmApiKey: apiKey })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id, llmApiKey: users.llmApiKey })

  if (!updated) {
    throw new Error('Failed to save — could not find your user account')
  }
  if (updated.llmApiKey !== apiKey) {
    throw new Error('Key was not persisted correctly — please try again')
  }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}

export async function removeLLMKey() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [updated] = await db.update(users)
    .set({ llmApiKey: null })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id })

  if (!updated) throw new Error('Failed to remove key — user not found')

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}

export async function setLLMProvider(provider: LLMProvider) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [updated] = await db.update(users)
    .set({ llmProvider: provider, llmApiKey: null })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id })

  if (!updated) throw new Error('Failed to update provider — user not found')

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}
