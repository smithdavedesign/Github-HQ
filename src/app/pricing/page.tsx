import { Check } from 'lucide-react'
import Link from 'next/link'
import { PLANS } from '@/lib/pricing'
import { cn } from '@/lib/utils'

export const metadata = {
  title: 'Pricing — RepoHQ',
  description: 'Simple, transparent pricing for developers and teams.',
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold">
            RepoHQ
          </Link>
          <Link
            href="/login"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Simple, transparent pricing
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free. Upgrade when your portfolio grows.
        </p>
      </section>

      {/* Plans */}
      <section className="mx-auto grid max-w-5xl gap-8 px-6 pb-24 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              'relative flex flex-col rounded-xl border p-8',
              plan.highlighted
                ? 'border-primary shadow-lg ring-1 ring-primary/20'
                : 'border-border',
            )}
          >
            {plan.highlighted && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                Most Popular
              </span>
            )}

            <h2 className="text-xl font-semibold">{plan.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.description}
            </p>

            <div className="mt-6">
              <span className="text-4xl font-bold tabular-nums">
                ${plan.price}
              </span>
              {plan.price > 0 && (
                <span className="text-sm text-muted-foreground">/month</span>
              )}
            </div>

            <ul className="mt-8 flex-1 space-y-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-8">
              {plan.price === 0 ? (
                <Link
                  href="/login"
                  className="block w-full rounded-md border border-border bg-secondary px-4 py-2.5 text-center text-sm font-medium hover:bg-secondary/80"
                >
                  {plan.cta}
                </Link>
              ) : plan.id === 'team' ? (
                <a
                  href="mailto:hello@repohq.dev?subject=RepoHQ Team Plan"
                  className="block w-full rounded-md border border-border bg-secondary px-4 py-2.5 text-center text-sm font-medium hover:bg-secondary/80"
                >
                  {plan.cta}
                </a>
              ) : (
                <Link
                  href="/login?plan=pro"
                  className="block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {plan.cta}
                </Link>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* FAQ */}
      <section className="border-t bg-muted/30 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-center">Frequently Asked Questions</h2>
          <div className="mt-10 space-y-8">
            <div>
              <h3 className="font-semibold">Can I try Pro for free?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Yes — every Pro subscription starts with a 14-day free trial. No credit card required to get started on the Free plan.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Can I cancel anytime?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Absolutely. Cancel from your Settings page and you&apos;ll keep access through the end of your billing period.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">What counts as a repository?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Any GitHub repository connected to RepoHQ. Archived repos don&apos;t count toward your limit on the Free plan.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} RepoHQ. All rights reserved.</p>
      </footer>
    </div>
  )
}
