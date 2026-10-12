import { getOpenAlertSummary, getPortfolioFeed } from '@/lib/actions/feed'
import { getPortfolioEvents } from '@/lib/actions/changelog'
import { getOpportunityCost } from '@/lib/actions/repositories'
import { OpportunityCostCard } from '@/components/dashboard/opportunity-cost-card'

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  TrendingDown, TrendingUp, XCircle, AlertTriangle,
  ShieldAlert, Shield, Clock, Wrench, Activity, Bot, GitPullRequest, ExternalLink,
} from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'
import type { FeedEvent, FeedEventSeverity } from '@/lib/actions/feed'
import { MilestonesTab } from '@/components/feed/milestones-tab'
import { FeedTabSwitcher } from '@/components/feed/feed-tab-switcher'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Feed' }

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
  agent_pr_opened:     GitPullRequest,
  agent_pr_merged:     Bot,
  agent_failed:        Bot,
  agent_report_ready:  Activity,
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

  const [events, milestones, opportunityCost, openAlerts] = await Promise.all([
    getPortfolioFeed(),
    getPortfolioEvents(),
    getOpportunityCost(),
    getOpenAlertSummary(),
  ])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Portfolio Feed</h1>
        <p className="text-muted-foreground text-sm mt-1">
          What happened across your repos, newest first, and your milestones
        </p>
      </div>

      <FeedTabSwitcher activeTab={activeTab} />

      {/* Opportunity Cost — weekly retrospective belongs here, not the main dashboard */}
      {activeTab === 'feed' && <OpportunityCostCard result={opportunityCost} />}

      {/* Standing alerts are a state, not an event: one line to the Security page instead of a row per repo. */}
      {activeTab === 'feed' && openAlerts.alerts > 0 && (
        <Link href="/security" className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-muted/50" data-testid="feed-open-alerts">
          <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" aria-hidden />
          <span><span className="font-medium tabular-nums">{openAlerts.alerts}</span> open critical and high alerts in {openAlerts.repos} repo{openAlerts.repos === 1 ? '' : 's'}</span>
          <span className="ml-auto text-xs text-muted-foreground">Security →</span>
        </Link>
      )}

      {activeTab === 'feed' ? (
        events.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nothing new</p>
            <p className="text-xs mt-1">Merges, health changes, new alerts and agent results show up here as they happen</p>
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
                        {event.repoId > 0 ? (
                          <Link href={`/repos/${event.repoId}`} className="text-sm font-medium hover:underline">
                            {event.repoName}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium">{event.repoName}</span>
                        )}
                        <p className="text-sm text-foreground mt-0.5">{event.description}</p>
                        {event.detail && !event.detail.startsWith('http') && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-sm">
                            {event.detail}
                          </p>
                        )}
                        {typeof event.meta?.prUrl === 'string' && (
                          <a
                            href={event.meta.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline mt-0.5 inline-flex items-center gap-1"
                          >
                            View PR <ExternalLink className="w-2.5 h-2.5" />
                          </a>
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
