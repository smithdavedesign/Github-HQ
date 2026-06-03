'use server'

import { auth } from '@/lib/auth'
import { getPlanById } from '@/lib/pricing'

/**
 * Creates a Stripe Checkout session for the given plan.
 * Returns the checkout URL to redirect the user to.
 *
 * Requires:
 * - STRIPE_SECRET_KEY env var
 * - The plan must have a valid stripePriceId
 */
export async function createCheckoutSession(planId: string): Promise<{ url: string | null; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) {
    return { url: null, error: 'You must be signed in to subscribe.' }
  }

  const plan = getPlanById(planId)
  if (!plan) {
    return { url: null, error: 'Unknown plan.' }
  }

  if (!plan.stripePriceId) {
    return { url: null, error: 'This plan does not require payment.' }
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return { url: null, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' }
  }

  try {
    // Dynamic import to avoid bundling Stripe on pages that don't need it
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeSecretKey)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/settings?checkout=success`,
      cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
      client_reference_id: session.user.id,
      metadata: {
        userId: session.user.id,
        planId: plan.id,
      },
    })

    return { url: checkoutSession.url }
  } catch (err) {
    console.error('[checkout] Failed to create session:', err)
    return { url: null, error: 'Failed to create checkout session. Please try again.' }
  }
}
