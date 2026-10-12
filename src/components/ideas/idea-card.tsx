import Link from 'next/link'
import { ArrowRight, ExternalLink, GitPullRequest } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DemandMeters, PendingBadge, ScoreBadge, StageBadge } from './idea-bits'
import {
  buildRequestLabel, demandProgress, pendingDecision, safeUrl, shortTitle, tagline, type IdeaGroup, type IdeaPolicy, type IdeaView,
} from '@/lib/ideas/idea-utils'
import { errorSummary, formatDistanceToNow } from '@/lib/utils'

/** One idea in the list: enough to decide whether to open it, and the one number that matters for its stage. */
export function IdeaCard({ v, group, policy, now }: { v: IdeaView; group: IdeaGroup; policy: IdeaPolicy | null; now: Date }) {
  const pending = pendingDecision(v)
  const pr = safeUrl(v.state.build?.prUrl)
  const page = safeUrl(v.state.page?.url)
  const request = v.buildRequests?.[0] ?? null
  const reviewedAt = v.state.review?.at ? new Date(v.state.review.at) : null
  const demand = group === 'testing' ? demandProgress(v.signals, v.state, policy, now) : null
  return (
    <div className="group relative rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-within:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">
            <Link href={`/ideas/${v.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">{shortTitle(v.title)}</Link>
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{tagline(v)}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 mt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <StageBadge stage={v.stage} />
        <ScoreBadge score={v.state.review?.score} policy={policy} />
        {v.state.review && <Badge variant="outline" className="text-muted-foreground">review: {v.state.review.verdict}</Badge>}
        {v.idea.effort && <Badge variant="outline" className="text-muted-foreground">effort {v.idea.effort.toLowerCase()}</Badge>}
        {pending && <PendingBadge decision={pending} />}
      </div>

      {group !== 'testing' && v.state.review?.summary && (
        <p className="text-xs text-muted-foreground mt-3 line-clamp-3 leading-relaxed">{v.state.review.summary}</p>
      )}
      {group === 'decide' && !v.state.review && (
        <p className="text-xs text-muted-foreground mt-3">The AI review runs daily at 09:30. You can decide before it does.</p>
      )}

      {demand && (
        <div className="mt-3">
          <DemandMeters d={demand} compact />
          <p className="text-xs text-muted-foreground mt-2">{demand.status}{demand.daysLeft !== null ? ` Decision in ${demand.daysLeft}d.` : ''}</p>
        </div>
      )}

      {group === 'building' && (
        <p className="text-xs text-muted-foreground mt-3">
          {/* A newer request (running or queued) outranks an older failure in the state. */}
          {v.state.build?.status === 'running' ? `${v.state.build.milestone ?? 'M1'} is being built now.`
            : request && (request.status === 'running' || request.status === 'pending') ? buildRequestLabel(request)
            : pr ? `${v.state.build?.milestone ?? 'M1'} PR ${v.state.build?.status ?? 'open'}${v.state.build?.testsPassing === false ? ' (tests failing)' : ''}.`
            : v.state.build?.status === 'failed' ? <span title={v.state.build.reason ?? undefined}>Last build failed: {errorSummary(v.state.build.reason ?? 'see the record', 140)}</span>
            : v.state.repo ? 'Repo created; M1 waits for its build slot.' : 'Approved; the repo is created on the next run.'}
        </p>
      )}

      {group === 'live' && <p className="text-sm font-mono mt-3">${(v.state.revenue?.mrr ?? 0).toFixed(2)} MRR</p>}

      {(pr || page) && (
        <div className="relative z-10 flex flex-wrap gap-3 mt-3 text-xs">
          {page && <a href={page} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3 w-3" />Landing page</a>}
          {pr && <a href={pr} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><GitPullRequest className="h-3 w-3" />Milestone PR</a>}
        </div>
      )}

      {reviewedAt && group === 'decide' && (
        <p className="text-[11px] text-muted-foreground mt-3">Reviewed {formatDistanceToNow(reviewedAt, now.getTime())}</p>
      )}
    </div>
  )
}
