/**
 * Pricing plan definitions.
 * Central source of truth for the pricing page and checkout flow.
 */

export interface PricingPlan {
  id: string
  name: string
  description: string
  price: number // monthly price in USD, 0 = free
  features: string[]
  cta: string
  highlighted: boolean
  stripePriceId: string | null // null = free tier (no checkout)
}

export const PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'For individual developers getting started.',
    price: 0,
    features: [
      'Up to 10 repositories',
      'Health scoring',
      'Weekly digest emails',
      'Community support',
    ],
    cta: 'Get Started',
    highlighted: false,
    stripePriceId: null,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For serious developers managing a portfolio.',
    price: 19,
    features: [
      'Unlimited repositories',
      'AI Portfolio Advisor',
      'Agent auto-dispatch',
      'Security scanning',
      'Deployment monitoring',
      'Priority support',
    ],
    cta: 'Start Pro Trial',
    highlighted: true,
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID ?? null,
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For teams shipping together.',
    price: 49,
    features: [
      'Everything in Pro',
      'Team dashboard',
      'Shared goals & milestones',
      'Webhook integrations',
      'SSO (coming soon)',
      'Dedicated support',
    ],
    cta: 'Contact Us',
    highlighted: false,
    stripePriceId: process.env.STRIPE_TEAM_PRICE_ID ?? null,
  },
]

export function getPlanById(id: string): PricingPlan | undefined {
  return PLANS.find((p) => p.id === id)
}

export function getFreePlan(): PricingPlan {
  return PLANS.find((p) => p.price === 0)!
}

export function getPaidPlans(): PricingPlan[] {
  return PLANS.filter((p) => p.price > 0)
}
