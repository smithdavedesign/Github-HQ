'use server'

import { auth } from '@/lib/auth'
import { getPlanById } from '@/lib/pricing'

/**
 * Creates a Stripe Checkout session using the Stripe REST API directly.
 * No Stripe SDK — consistent with the plain-fetch approach used throughout.
 */
export async function createCheckoutSession(
  planId: string,
): Promise<{ url: string | null; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) {
    return { url: null, error: 'You must be signed in to subscribe.' }
  }

  const plan = getPlanById(planId)
  if (!plan) return { url: null, error: 'Unknown plan.' }
  if (!plan.stripePriceId) return { url: null, error: 'This plan does not require payment.' }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return { url: null, error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to your environment.' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  // Build form-encoded body for the Stripe Checkout Sessions API
  const params = new URLSearchParams({
    mode:                        'subscription',
    'line_items[0][price]':      plan.stripePriceId,
    'line_items[0][quantity]':   '1',
    success_url:                 `${appUrl}/settings?checkout=success`,
    cancel_url:                  `${appUrl}/pricing?checkout=cancelled`,
    client_reference_id:         session.user.id,
    'metadata[userId]':          session.user.id,
    'metadata[planId]':          plan.id,
  })

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } }
      console.error('[checkout] Stripe API error:', err.error?.message)
      return { url: null, error: err.error?.message ?? 'Failed to create checkout session.' }
    }

    const data = await res.json() as { url: string | null }
    return { url: data.url }
  } catch (err) {
    console.error('[checkout] Network error:', err)
    return { url: null, error: 'Failed to create checkout session. Please try again.' }
  }
}
