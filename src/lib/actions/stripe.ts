'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto-utils'
import { fetchStripeMrr, resolveStripeKey, syncStripeMrrForUser } from '@/lib/stripe/mrr'

export interface StripeProduct {
  id: string
  name: string
  mrr: number              // calculated monthly recurring revenue
  subscriberCount: number
}

async function fetchStripeProducts(apiKey: string, productIds: string[]): Promise<Map<string, string>> {
  const nameById = new Map<string, string>()
  // Parallel requests — was sequential await in a loop
  const results = await Promise.allSettled(
    productIds.map(id =>
      fetch(`https://api.stripe.com/v1/products/${id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      }).then(res => res.ok ? res.json() as Promise<{ id: string; name: string }> : null)
    )
  )
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      nameById.set(r.value.id, r.value.name)
    }
  }
  return nameById
}

export async function saveStripeKey(apiKey: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Validate the key works before saving
  const res = await fetch('https://api.stripe.com/v1/subscriptions?limit=1', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error('Invalid Stripe API key — check it has read access to subscriptions')

  await db.update(users)
    .set({ stripeApiKey: encrypt(apiKey) })
    .where(eq(users.id, session.user.id))
}

export async function removeStripeKey() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  await db.update(users).set({ stripeApiKey: null }).where(eq(users.id, session.user.id))
}

export async function getStripeProducts(): Promise<StripeProduct[]> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const apiKey = await resolveStripeKey(session.user.id)
  if (!apiKey) return []

  const mrrByProduct = await fetchStripeMrr(apiKey)
  const names = await fetchStripeProducts(apiKey, [...mrrByProduct.keys()])

  return [...mrrByProduct.entries()]
    .map(([id, { mrr, count }]) => ({
      id,
      name: names.get(id) ?? id,
      mrr: Math.round(mrr / 100),   // convert cents to dollars
      subscriberCount: count,
    }))
    .sort((a, b) => b.mrr - a.mrr)
}

export async function mapStripeProduct(repoId: number, stripeProductId: string | null) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.update(repositories)
    .set({ stripeProductId })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}

/** Sync MRR from Stripe for the signed-in user (Settings). The cron uses syncStripeMrrForUser. */
export async function syncStripeMrr(): Promise<{ synced: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return syncStripeMrrForUser(session.user.id)
}

export async function hasStripeKey(): Promise<boolean> {
  try {
    const session = await auth()
    if (!session?.user?.id) return false
    return (await stripeKeySource()) !== null
  } catch {
    return false
  }
}

export async function stripeKeySource(): Promise<'db' | 'env' | null> {
  try {
    const session = await auth()
    if (!session?.user?.id) return null
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { stripeApiKey: true },
    })
    if (user?.stripeApiKey) return 'db'
    if (process.env.STRIPE_API_KEY) return 'env'
    return null
  } catch {
    return null
  }
}
