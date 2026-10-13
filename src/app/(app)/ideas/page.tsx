import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, ExternalLink, Lightbulb } from 'lucide-react'
import { auth } from '@/lib/auth'
import { factoryAccess } from '@/lib/agents/factory-queue'
import { loadIdeasOverview } from '@/lib/ideas/ideas-data'
import {
  GROUP_LABEL, GROUP_ORDER, IDEA_BOARD_URL, buildSlot, groupIdeas, pipelineHealth, type IdeaGroup,
} from '@/lib/ideas/idea-utils'
import { filterIdeas, filtersActive, parseIdeaFilters, sortIdeas, tagCounts, topicTags } from '@/lib/ideas/idea-filters'
import { IdeaCard } from '@/components/ideas/idea-card'
import { IdeaFilterBar } from '@/components/ideas/idea-filter-bar'
import { NewIdea } from '@/components/ideas/new-idea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Ideas' }

export default async function IdeasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const access = factoryAccess(session.user.id)

  if (!access.ok) {
    return (
      <div className="max-w-5xl mx-auto space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Ideas</h1>
        <p className="text-sm text-muted-foreground">The idea pipeline belongs to the factory’s owner. {access.reason}</p>
      </div>
    )
  }

  const { views, pipeline, seeds, missingTables } = await loadIdeasOverview()
  const now = new Date()
  const groups = groupIdeas(views, now)
  const slot = buildSlot(views, pipeline.policy, now)
  const health = pipelineHealth(pipeline.tickAt, pipeline.ok, now)
  const maxValidating = pipeline.policy?.validation?.maxValidating ?? 5
  const mrr = views.reduce((n, v) => n + (v.state.revenue?.mrr ?? 0), 0)
  const first = groups.decide[0]?.slug
  // The stats above count every idea; the filters (in the URL) narrow and order the lists below.
  const filters = parseIdeaFilters(await searchParams)
  const filtered = filtersActive(filters)
  const shown = filterIdeas(views, filters)
  const shownGroups = groupIdeas(shown, now)
  for (const g of GROUP_ORDER) shownGroups[g] = sortIdeas(shownGroups[g], filters.sort)

  const stats: { label: string; value: string; hint: string }[] = [
    { label: 'Needs your call', value: String(groups.decide.length), hint: 'new or recently reviewed' },
    { label: 'Demand tests', value: `${groups.testing.length}/${maxValidating}`, hint: 'running, of the cap' },
    { label: 'Build slot', value: slot.free ? 'Free' : 'Used', hint: `${slot.free ? `${slot.used} of ${slot.max} this week` : `next ${slot.nextFreeAt?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) ?? 'soon'}`}${slot.held ? '; new ideas wait for traction' : ''}` },
    { label: 'Idea MRR', value: `$${mrr.toFixed(0)}`, hint: `${groups.live.length} live` },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Lightbulb className="h-6 w-6 text-amber-500" />Ideas</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Researched and reviewed ideas from the idea pipeline. Approve a build, send one to a $0 demand test, or pass:
            the pipeline acts on your call within 15 minutes, through the Notion board it already follows.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" asChild>
            <a href={IDEA_BOARD_URL} target="_blank" rel="noopener noreferrer"><ExternalLink />Notion board</a>
          </Button>
          {first && (
            <Button size="sm" asChild>
              <Link href={`/ideas/${first}`}>Review {groups.decide.length} idea{groups.decide.length === 1 ? '' : 's'}<ArrowRight /></Link>
            </Button>
          )}
        </div>
      </div>

      {missingTables ? (
        <SetupNote title="The Ideas tables aren’t in this database yet">
          Run <code className="font-mono text-xs bg-muted rounded px-1">npm run db:push</code> in RepoHQ. The idea pipeline then syncs every idea here on its next run (every 15 minutes).
        </SetupNote>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-semibold tabular-nums mt-0.5">{s.value}</p>
                <p className="text-[11px] text-muted-foreground">{s.hint}</p>
              </div>
            ))}
          </div>

          <NewIdea seeds={seeds} perDay={pipeline.policy?.research?.seeded?.maxPerDay ?? 10} />

          <div className={cn('flex items-start gap-2 text-xs rounded-lg border px-3 py-2', health.stale || pipeline.ok === false ? 'border-amber-500/30 bg-amber-500/5' : 'bg-muted/30')}>
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', health.stale ? 'bg-amber-500' : pipeline.ok === false ? 'bg-red-500' : 'bg-emerald-500')} aria-hidden />
            <div className="space-y-0.5">
              <p>{health.label}</p>
              {pipeline.ok === false && pipeline.errors.slice(0, 3).map(e => <p key={e} className="text-muted-foreground font-mono break-all">{e}</p>)}
            </div>
          </div>

          {views.length === 0 ? (
            <SetupNote title="No ideas synced yet">
              The idea pipeline copies every idea here on each run. If this stays empty, check that the pipeline on the Mac has the RepoHQ sync step (idea-factory bin/idea-pipeline.js).
            </SetupNote>
          ) : (
            <>
              <IdeaFilterBar filters={filters} counts={tagCounts(views)} topics={topicTags(views)} shown={shown.length} total={views.length} />
              {filtered && shown.length === 0 && <p className="text-sm text-muted-foreground">No ideas match these filters.</p>}
              {GROUP_ORDER.map(g => <Group key={g} group={g} items={shownGroups[g]} policy={pipeline.policy} now={now} filtered={filtered} />)}
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Keyboard on an idea: <Kbd>A</Kbd> approve build · <Kbd>T</Kbd> demand test · <Kbd>P</Kbd> pass · <Kbd>←</Kbd><Kbd>→</Kbd> previous / next to review · <Kbd>Esc</Kbd> back here.
          </p>
        </>
      )}
    </div>
  )
}

function Group({ group, items, policy, now, filtered }: { group: IdeaGroup; items: ReturnType<typeof groupIdeas>[IdeaGroup]; policy: Parameters<typeof IdeaCard>[0]['policy']; now: Date; filtered: boolean }) {
  if (items.length === 0 && (group !== 'decide' || filtered)) return null
  const { title, blurb } = GROUP_LABEL[group]
  const body = items.length === 0
    ? <p className="text-sm text-muted-foreground">Nothing waiting on you. New ideas arrive daily at 09:00, and ideas you send are researched within about half an hour.</p>
    : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(v => <IdeaCard key={v.slug} v={v} group={group} policy={policy} now={now} />)}</div>
  if (group === 'passed') {
    return (
      // Open while filtering, so matching passed ideas aren't hidden behind "Show".
      <details className="group/passed space-y-3" open={filtered}>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h2 className="inline text-lg font-semibold">{title}</h2>
          <span className="ml-2 text-sm text-muted-foreground">{items.length} · {blurb} <span className="group-open/passed:hidden">Show</span><span className="hidden group-open/passed:inline">Hide</span></span>
        </summary>
        <div className="mt-3">{body}</div>
      </details>
    )
  }
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title} <span className="text-muted-foreground font-normal text-sm">{items.length}</span></h2>
        <p className="text-sm text-muted-foreground">{blurb}</p>
      </div>
      {body}
    </section>
  )
}

function SetupNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-1">{children}</p>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="font-mono text-[10px] border rounded px-1 py-0.5 mx-0.5 bg-muted/50">{children}</kbd>
}
