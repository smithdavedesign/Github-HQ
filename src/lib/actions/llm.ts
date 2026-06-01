'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { testLLMKey } from '@/lib/ai/adapter'
import type { LLMProvider } from '@/lib/ai/adapter'

export async function getLLMSettings(): Promise<{ provider: LLMProvider; hasKey: boolean; keySource: 'user' | 'env' | null }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { llmProvider: true, llmApiKey: true },
  })

  const provider = (user?.llmProvider ?? 'anthropic') as LLMProvider
  const hasUserKey = !!user?.llmApiKey
  const hasEnvKey = provider === 'anthropic' && !!process.env.ANTHROPIC_API_KEY

  return {
    provider,
    hasKey: hasUserKey || hasEnvKey,
    keySource: hasUserKey ? 'user' : hasEnvKey ? 'env' : null,
  }
}

export async function saveLLMSettings(provider: LLMProvider, apiKey: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Validate before saving
  await testLLMKey(provider, apiKey)

  await db.update(users)
    .set({ llmProvider: provider, llmApiKey: apiKey })
    .where(eq(users.id, session.user.id))

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}

export async function removeLLMKey() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.update(users)
    .set({ llmApiKey: null })
    .where(eq(users.id, session.user.id))

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}

export async function setLLMProvider(provider: LLMProvider) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.update(users)
    .set({ llmProvider: provider, llmApiKey: null })
    .where(eq(users.id, session.user.id))

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}
