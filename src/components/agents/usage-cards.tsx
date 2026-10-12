import Link from 'next/link'
import { CheckCircle, CircleDashed, Gauge, GitPullRequest, Hammer, Lightbulb, XCircle } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'
import { pipelineHealth } from '@/lib/ideas/idea-utils'
import type { UsageOverview } from '@/lib/agents/usage-data'
import { engineText, type IdeaRun, type UsageWindow } from '@/lib/agents/usage-utils'
import { fmtDuration } from './format'

const KIND_STYLE: Record<IdeaRun['kind'], string> = {
  research: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  review: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  build: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  revenue: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

function Limit({ label, used, cap, note }: { label: string; used: number; cap: number; note: string }) {
  const full = used >= cap
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className={`text-sm font-semibold tabular-nums ${full ? 'text-amber-600 dark:text-amber-400' : ''}`}>{used}/{cap}</div>
      <div className="text-[10px] text-muted-foreground">{label} · {note}</div>
    </div>
  )
}

/**
 * The idea pipeline (idea-factory on the Mac, launchd every 15 min): the Agents page's second worker
 * next to the factory. Health, what's building, what's queued, the owner's caps and the latest runs.
 */
export function IdeaPipelineCard({ o, now }: { o: UsageOverview; now: Date }) {
  const health = pipelineHealth(o.pipeline.tickAt, o.pipeline.ok, now)
  const effort = o.pipeline.policy?.build?.effort ?? null
  const { builds, awaitingReview, seedsQueued, prsToReview } = o.queue
  const queued = [
    builds.length && plural(builds.length, 'build request'),
    awaitingReview && `${plural(awaitingReview, 'idea')} awaiting review`,
    seedsQueued && `${plural(seedsQueued, 'idea')} from the Ideas page queued for research`,
    prsToReview && `${plural(prsToReview, 'milestone PR')} waiting for your review`,
  ].filter(Boolean) as string[]
  return (
    <section className="space-y-2" data-testid="idea-pipeline">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
        Idea pipeline
        <span className="text-[11px] font-normal text-muted-foreground">research · review · build on Claude Pro, from idea-factory on the Mac</span>
        <Link href="/ideas" className="ml-auto text-[11px] font-normal text-primary hover:underline">Ideas page</Link>
      </h2>
      <div className="rounded-lg border border-border/50 p-3 text-xs space-y-3">
        <p className={health.stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>{health.label}</p>
        {o.pipeline.errors.length > 0 && <p className="text-red-600 dark:text-red-400">Last run’s errors: {o.pipeline.errors.slice(0, 2).join('; ')}</p>}

        <div className="space-y-1" data-testid="idea-pipeline-building">
          <p className="font-medium">Building now</p>
          {o.building.length === 0 ? <p className="text-muted-foreground">Nothing is building.</p> : o.building.map(b => (
            <p key={b.idea} className="flex items-center gap-1.5">
              <Hammer className="w-3 h-3 text-amber-500 shrink-0" />
              <Link href={`/ideas/${b.idea}`} className="font-medium hover:underline">{b.idea}</Link>
              <span>{b.milestone ?? 'M1'}</span>
              <span className="text-muted-foreground">started {formatDistanceToNow(b.since, now.getTime())}{b.model ? ` on ${b.model}${effort ? ` at ${effort}` : ''}` : ''}{b.manual ? ' · Start build now' : ''}</span>
            </p>
          ))}
          {builds.map(q => (
            <p key={`${q.slug}-${q.createdAt.toISOString()}`} className="flex items-center gap-1.5 text-muted-foreground">
              <CircleDashed className="w-3 h-3 shrink-0" />
              <Link href={`/ideas/${q.slug}`} className="hover:underline">{q.slug}</Link> {q.milestone ?? 'M1'} queued {formatDistanceToNow(q.createdAt, now.getTime())}{q.result ? ` — ${q.result}` : ''}
            </p>
          ))}
        </div>

        {queued.length > 0 && <p className="text-muted-foreground">Queued: {queued.join(' · ')}</p>}

        <div className="grid grid-cols-3 gap-2" data-testid="idea-pipeline-limits">
          <Limit label="Manual builds" used={o.limits.manual.used} cap={o.limits.manual.cap} note="24 h" />
          <Limit label="Weekly build slot" used={o.limits.weekly.used} cap={o.limits.weekly.max}
            note={o.limits.weekly.free ? 'this week' : `next ${o.limits.weekly.nextFreeAt?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? 'soon'}`} />
          <Limit label="Seeded research" used={o.limits.seeded.used} cap={o.limits.seeded.cap} note="24 h" />
        </div>

        <div className="pt-1 border-t border-border/40 space-y-1" data-testid="idea-pipeline-runs">
          <p className="font-medium">Latest runs</p>
          {o.runs.filter(r => r.status !== 'start').length === 0 ? <p className="text-muted-foreground">No research, review or build in the last 7 days.</p> : (
            o.runs.filter(r => r.status !== 'start').slice(0, 10).map((r, i) => {
              const engine = engineText(r, r.kind === 'build' ? effort : null)
              return (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="text-muted-foreground shrink-0 w-16 tabular-nums">{formatDistanceToNow(r.at, now.getTime())}</span>
                  {r.status === 'fail' ? <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-red-500" /> : <CheckCircle className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" />}
                  <span className={`shrink-0 rounded px-1 ${KIND_STYLE[r.kind]}`}>{r.kind}{r.kind === 'build' && r.milestone ? ` ${r.milestone}` : ''}{r.seeded ? ' · sent' : ''}</span>
                  {r.idea && <Link href={`/ideas/${r.idea}`} className="shrink-0 font-medium hover:underline">{r.idea}</Link>}
                  <span className="truncate text-muted-foreground" title={r.summary}>{r.summary}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {[r.durationMs !== null ? fmtDuration(r.durationMs) : null, engine, r.fellBack ? 'fell back' : null].filter(Boolean).join(' · ')}
                  </span>
                  {r.prUrl && <a href={r.prUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-primary" aria-label={`PR for ${r.idea ?? 'this build'}`}><GitPullRequest className="w-3 h-3" /></a>}
                </div>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}

function WindowLine({ w, label }: { w: UsageWindow; label: string }) {
  return (
    <p>
      <span className="font-medium">{label}:</span> {plural(w.runs, 'run')}
      {w.runs > 0 && <> ({w.byKind.research} research · {w.byKind.review} review · {w.byKind.build} build{w.byKind.revenue ? ` · ${w.byKind.revenue} revenue plan` : ''}), {w.minutesPartial ? 'at least ' : ''}{w.minutes} min</>}
      {w.fellBack > 0 && <span className="text-amber-600 dark:text-amber-400"> · {w.fellBack} fell back</span>}
      {w.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {w.failed} failed</span>}
    </p>
  )
}

/** Claude Pro and GitHub Copilot: the subscriptions the agents spend, side by side. */
export function UsageCards({ o, now }: { o: UsageOverview; now: Date }) {
  const c = o.claude
  const cp = o.copilot
  const pct = cp?.percentRemaining ?? null
  return (
    <section className="space-y-2" data-testid="usage-cards">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Gauge className="w-3.5 h-3.5 text-indigo-500" />
        Subscriptions
        <span className="text-[11px] font-normal text-muted-foreground">what the agents spend of your plans</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/50 p-3 text-xs space-y-1.5" data-testid="claude-usage">
          <p className="font-semibold text-sm">Claude Pro</p>
          <p className="text-[11px] text-muted-foreground">Idea research, reviews and builds. Your own Claude Code sessions share it and aren’t counted here.</p>
          <WindowLine w={c.day} label="Last 24 h" />
          <WindowLine w={c.week} label="Last 7 days" />
          {c.lastCapacity
            ? <p className="text-amber-600 dark:text-amber-400">Last time it couldn’t take the work: {formatDistanceToNow(c.lastCapacity.at, now.getTime())} — <span className="text-muted-foreground">{c.lastCapacity.message.slice(0, 160)}</span></p>
            : <p className="text-emerald-600 dark:text-emerald-400">No usage limit hit in the last 7 days.</p>}
        </div>

        <div className="rounded-lg border border-border/50 p-3 text-xs space-y-1.5" data-testid="copilot-usage">
          <p className="font-semibold text-sm">GitHub Copilot{cp?.plan ? <span className="font-normal text-muted-foreground"> · {cp.plan}</span> : null}</p>
          <p className="text-[11px] text-muted-foreground">The factory’s Copilot builder (tier MC) and Copilot code reviews.</p>
          {!cp ? (
            <p className="text-muted-foreground">No snapshot yet: the factory publishes one each cycle when it changes (factory/copilot/usage).</p>
          ) : !cp.installed ? (
            <p className="text-muted-foreground">The Copilot CLI isn’t installed on the Mac, so the factory doesn’t use it.</p>
          ) : (
            <>
              {pct === null ? <p className="text-muted-foreground">Premium-request quota unknown (GitHub didn’t say).</p> : (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="Copilot premium requests left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                    <div className={`h-full ${pct <= 10 ? 'bg-red-500' : pct <= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                  </div>
                  <p><span className="font-medium">{Math.round(pct)}%</span> of premium requests left{cp.resetDate ? `, resets ${cp.resetDate}` : ''}{pct <= 0 ? (cp.overagePermitted ? ' (overage on)' : ' — the factory pauses Copilot until then') : ''}</p>
                </div>
              )}
              <p><span className="font-medium">{cp.stale ? `On ${cp.at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Today'}:</span> {cp.tasksToday}/{cp.maxTasksPerDay} builder tasks · {cp.reviewsToday}/{cp.maxReviewsPerDay} reviews</p>
              <p className={cp.stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>Snapshot {formatDistanceToNow(cp.at, now.getTime())}</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
