import { getPortfolioFeed } from '@/lib/actions/feed'
import { getPortfolioEvents } from '@/lib/actions/changelog'
import { getOpportunityCost } from '@/lib/actions/repositories'
import { OpportunityCostCard } from '@/components/dashboard/opportunity-cost-card'

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  TrendingDown, TrendingUp, XCircle, AlertTriangle,
  ShieldAlert, Shield, Clock, Wrench, Activity,
} from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'
import type { FeedEvent, FeedEventSeverity } from '@/lib/actions/feed'
import { MilestonesTab } from '@/components/feed/milestones-tab'
import { FeedTabSwitcher } from '@/components/feed/feed-tab-switcher'

const SEVERITY_STYLES: Record<FeedEventSeverity, string> = {
  critical: 'border-l-red-500 bg-red-500/5',
  warning:  'border-l-amber-500 bg-amber-500/5',
  info:     'border-l-slate-400 bg-muted/30',
  positive: 'border-l-emerald-500 bg-emerald-500/5',
}

const EVENT_ICONS: Record<FeedEvent['type'], typeof TrendingDown> = {
  health_drop:         TrendingDown,
  health_improved:     TrendingUp,
  deployment_down:     XCircle,
  deployment_slow:     AlertTriangle,
  security_critical:   ShieldAlert,
  security_high:       Shield,
  dormant:             Clock,
  no_tests:            Wrench,
  build_failing:       Activity,
  dep_cascade_risk:    AlertTriangle,
}

const ICON_COLORS: Record<FeedEventSeverity, string> = {
  critical: 'text-red-500',
  warning:  'text-amber-500',
  info:     'text-slate-400',
  positive: 'text-emerald-500',
}

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function FeedPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { tab } = await searchParams
  const activeTab = tab === 'milestones' ? 'milestones' : 'feed'
  const currentYear = new Date().getFullYear()

  const [events, milestones, opportunityCost] = await Promise.all([
    getPortfolioFeed(),
    getPortfolioEvents(),
    getOpportunityCost(),
  ])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Portfolio Feed</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Portfolio events, alerts, and milestones
        </p>
      </div>

      <FeedTabSwitcher activeTab={activeTab} />

      {/* Opportunity Cost — weekly retrospective belongs here, not the main dashboard */}
      {activeTab === 'feed' && <OpportunityCostCard result={opportunityCost} />}

      {activeTab === 'feed' ? (
        events.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">All clear — no issues detected</p>
            <p className="text-xs mt-1">Run a sync to check your latest repo health</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map(event => {
              const Icon = EVENT_ICONS[event.type] ?? Activity
              return (
                <div
                  key={event.id}
                  className={`flex gap-3 p-4 rounded-lg border-l-4 border border-border ${SEVERITY_STYLES[event.severity]}`}
                >
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLORS[event.severity]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <Link
                          href={`/repos/${event.repoId}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {event.repoName}
                        </Link>
                        <p className="text-sm text-foreground mt-0.5">{event.description}</p>
                        {event.detail && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-sm">
                            {event.detail}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(event.date)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <MilestonesTab events={milestones} exportYear={currentYear} />
      )}
    </div>
  )
}
