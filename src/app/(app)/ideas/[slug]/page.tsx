import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, BookOpen, ExternalLink, GitBranch, GitPullRequest, Globe } from 'lucide-react'
import { auth } from '@/lib/auth'
import { factoryAccess } from '@/lib/agents/factory-queue'
import { loadIdea } from '@/lib/ideas/ideas-data'
import {
  DECISION_LABEL, launchKitOrder, buildMvpSteps, buildMvpTarget, goLiveSteps, goLiveTarget, buildNowSteps, buildNowTarget, buildRequestLabel, milestoneRange, buildSlot, checkDecision, decisionLabel, demandProgress, ideaRecordUrl,
  growthKindLabel, manualStartsLast24h, pendingDecision, pipelineHealth, reviewQueue, safeUrl, shortTitle, tagline, whatHappens, type IdeaDecisionKind, type IdeaView,
} from '@/lib/ideas/idea-utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DemandMeters, ForcingQuestions, PendingBadge, ScoreBadge, StageBadge } from '@/components/ideas/idea-bits'
import { IdeaMarkdown } from '@/components/ideas/markdown'
import { DecisionPanel } from '@/components/ideas/decision-panel'
import { BuildNow } from '@/components/ideas/build-now'
import { RevenueCard } from '@/components/ideas/revenue-card'
import { GrowthCard } from '@/components/ideas/growth-card'
import { ReviewNav } from '@/components/ideas/review-nav'
import { CopyButton } from '@/components/ideas/copy-button'
import { cn, errorSummary, formatDistanceToNow } from '@/lib/utils'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  return { title: `${slug} · Ideas` }
}

const KINDS: IdeaDecisionKind[] = ['build', 'validate', 'pass']

export default async function IdeaPage({ params }: Props) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  if (!factoryAccess(session.user.id).ok) redirect('/ideas')

  const { view: v, overview } = await loadIdea(slug)
  if (!v) notFound()
  const now = new Date()
  const policy = overview.pipeline.policy

  // Review queue: ← → step through it, and a decision moves on to the next one.
  const queue = reviewQueue(overview.views, now)
  const idx = queue.indexOf(slug)
  const prevSlug = idx > 0 ? queue[idx - 1]! : null
  const nextInQueue = idx >= 0 ? queue[idx + 1] ?? null : null
  const afterDecision = idx >= 0 ? (queue[idx + 1] ?? queue[idx - 1] ?? null) : null

  const slot = buildSlot(overview.views, policy, now)
  const validating = overview.views.filter(x => x.stage === 'validate').length
  const pending = pendingDecision(v)
  const health = pipelineHealth(overview.pipeline.tickAt, overview.pipeline.ok, now)
  const options = KINDS.map(kind => ({ kind, label: decisionLabel(kind, v.stage), check: checkDecision(v, kind), steps: whatHappens(kind, v, slot, policy, validating) }))
  const r = v.review
  const page = safeUrl(v.state.page?.url)
  const repo = safeUrl(v.state.repo)
  const pr = safeUrl(v.state.build?.prUrl)
  const notion = safeUrl(v.notionUrl)
  const launchPost = r?.launch?.post ? r.launch.post.replace(/\{url\}/g, v.state.page?.url ?? '{url}') : null
  const kitOrder = launchKitOrder(v.docs.launchKit)
  // "Start build now": the next milestone outside the weekly slot (idea_build_requests).
  const buildTarget = buildNowTarget(v)
  const startsToday = manualStartsLast24h(overview.views, now)
  const buildSteps = buildTarget.ok ? buildNowSteps(buildTarget.milestone, v, policy, startsToday) : []
  // "Build the MVP": every remaining milestone in one run (policy.build.mvp).
  const mvpTarget = buildMvpTarget(v, policy?.build?.mvp?.maxMilestones ?? 6)
  const mvpSteps = mvpTarget.ok ? buildMvpSteps(mvpTarget.milestones, v, policy, startsToday) : []
  // "Get it launch-ready" (idea-factory go-live): any time after M1 is merged.
  const liveTarget = goLiveTarget(v)
  const liveSteps = liveTarget.ok ? goLiveSteps(v, policy, startsToday) : []
  const lastRequest = v.buildRequests[0] ?? null

  const tabs = [
    { id: 'prd', label: 'PRD', md: v.docs.prd },
    { id: 'research', label: 'Research', md: v.docs.research },
    { id: 'roadmap', label: 'Roadmap', md: v.docs.roadmap },
    { id: 'review', label: 'Full review', md: v.docs.review },
    { id: 'launch', label: 'Launch post', md: v.docs.launch },
    { id: 'launchKit', label: 'Launch kit', md: v.docs.launchKit },
    { id: 'build', label: 'Build notes', md: v.docs.build },
    { id: 'revenue', label: 'Revenue plan', md: v.docs.revenue },
    { id: 'learnings', label: 'Learnings', md: v.docs.learnings },
  ].filter((t): t is { id: string; label: string; md: string } => !!t.md?.trim())
  const sources = (v.idea.sources ?? []).map(safeUrl).filter((u): u is string => !!u)

  return (
    <div className="max-w-6xl mx-auto space-y-6 max-lg:pb-28">
      <div className="flex items-center justify-between gap-3">
        <Link href="/ideas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Ideas</Link>
        <ReviewNav position={idx >= 0 ? idx + 1 : null} total={queue.length} prevSlug={prevSlug} nextSlug={nextInQueue} />
      </div>

      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{shortTitle(v.title)}</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">{tagline(v)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={v.stage} />
          <ScoreBadge score={v.state.review?.score} policy={policy} />
          {v.state.review && <Badge variant="outline" className="text-muted-foreground">review: {v.state.review.verdict}</Badge>}
          {v.idea.effort && <Badge variant="outline" className="text-muted-foreground">effort {v.idea.effort.toLowerCase()}</Badge>}
          {v.idea.confidence && <Badge variant="outline" className="text-muted-foreground">confidence {v.idea.confidence.toLowerCase()}</Badge>}
          {(v.idea.tags ?? []).map(t => <Badge key={t} variant="secondary">{t}</Badge>)}
          {pending && <PendingBadge decision={pending} />}
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {notion && <ExtLink href={notion} icon={BookOpen}>Notion row</ExtLink>}
          {page && <ExtLink href={page} icon={Globe}>Landing page</ExtLink>}
          {repo && <ExtLink href={repo} icon={GitBranch}>Repo</ExtLink>}
          {pr && <ExtLink href={pr} icon={GitPullRequest}>Milestone PR</ExtLink>}
          <ExtLink href={ideaRecordUrl(v.slug)} icon={ExternalLink}>Record on GitHub</ExtLink>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-6 min-w-0">
          {r ? <ReviewCard v={v} /> : (
            <Card><CardContent className="py-5 text-sm text-muted-foreground">
              Not reviewed yet: the gstack review runs daily at 09:30 (up to {policy?.review?.maxPerDay ?? 3} a day). Read the PRD and research below, or decide now.
            </CardContent></Card>
          )}

          {tabs.length > 0 && (
            <Tabs defaultValue={tabs[0]!.id} className="gap-3">
              <TabsList className="flex-wrap h-auto">
                {tabs.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
                {sources.length > 0 && <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>}
              </TabsList>
              {tabs.map(t => (
                <TabsContent key={t.id} value={t.id}>
                  <Card><CardContent className="py-5">
                    {t.id === 'launch' && launchPost && <div className="mb-4 flex justify-end"><CopyButton text={launchPost} label="Copy launch post" /></div>}
                    <IdeaMarkdown>{t.md}</IdeaMarkdown>
                  </CardContent></Card>
                </TabsContent>
              ))}
              {sources.length > 0 && (
                <TabsContent value="sources">
                  <Card><CardContent className="py-5">
                    <ol className="list-decimal pl-5 space-y-1.5 text-sm">
                      {sources.map(u => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline break-all">{u}</a></li>)}
                    </ol>
                  </CardContent></Card>
                </TabsContent>
              )}
            </Tabs>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          {/* On a phone this card is an action bar pinned to the bottom, so deciding never means scrolling back. */}
          <Card className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:rounded-none max-lg:border-x-0 max-lg:border-b-0 max-lg:py-3 max-lg:shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
            <CardHeader className="pb-2 max-lg:hidden"><CardTitle className="text-base">Your call</CardTitle></CardHeader>
            <CardContent className="space-y-3 max-lg:space-y-2">
              <DecisionPanel
                slug={v.slug}
                name={shortTitle(v.title)}
                options={options}
                pending={pending ? { id: pending.id, decision: pending.decision, createdAt: pending.createdAt.toISOString(), note: pending.note } : null}
                nextSlug={afterDecision}
                blocked={overview.missingTables ? 'The Ideas tables aren’t in the database yet (npm run db:push).' : null}
              />
              <p className={cn('text-xs max-lg:hidden', health.stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{health.label}</p>
            </CardContent>
          </Card>

          {(v.stage === 'validate' || page) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Demand test</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DemandMeters d={demandProgress(v.signals, v.state, policy, now)} />
                {v.state.validation?.reason && <p className="text-xs text-muted-foreground">Last decision: {v.state.validation.reason}</p>}
                {launchPost && <CopyButton text={launchPost} label="Copy launch post" />}
                {kitOrder ? (
                  <div className="text-xs space-y-1">
                    <p className="font-medium">Where to post, in order <span className="font-normal text-muted-foreground">(launch kit: channels checked; posts in the Launch kit tab)</span></p>
                    <IdeaMarkdown>{kitOrder}</IdeaMarkdown>
                  </div>
                ) : (r?.launch?.channels ?? []).length > 0 && (
                  <ul className="text-xs space-y-1">
                    {r!.launch!.channels!.slice(0, 5).map(c => {
                      const u = safeUrl(c.url)
                      return <li key={c.name}>{u ? <a href={u} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{c.name}</a> : c.name}{c.why ? <span className="text-muted-foreground"> · {c.why}</span> : null}</li>
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {(repo || v.state.build) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Build</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1.5">
                <p>{v.state.build?.status === 'running' ? `${v.state.build.milestone ?? 'M1'} is being built now.`
                  : v.state.build?.status === 'failed' ? `${v.state.build.milestone ?? 'M1'} failed: ${errorSummary(v.state.build.reason ?? 'see the record', 200)}`
                  : pr && v.state.build?.milestone === 'GOLIVE' ? `Go-live PR ${v.state.build.status ?? 'open'}: launch-ready changes, waiting for your review.`
                  : pr && v.state.build?.milestone === 'GROWTH' ? `Growth PR ${v.state.build.status ?? 'open'}: ${growthKindLabel(v.state.build.kind ?? 'one change')}, one change to test one idea.`
                  : pr && v.state.build?.milestone === 'MVP' ? `MVP (${milestoneRange(v.state.build.milestones?.length ? v.state.build.milestones : v.state.build.planned ?? [])}) PR ${v.state.build.status ?? 'open'}${v.state.build.stopped ? ` — stopped: ${v.state.build.stopped}` : ''}.`
                  : pr ? `${v.state.build?.milestone ?? 'M1'} PR ${v.state.build?.status ?? 'open'}${v.state.build?.testsPassing === false ? ' — tests failing' : v.state.build?.testsPassing ? ' — tests passing' : ''}.`
                  : slot.held ? `M1 not started: ${slot.held}. Start build now still works.`
                  : `M1 not started. Build slot: ${slot.free ? 'free this week' : `used, next ${slot.nextFreeAt?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? 'soon'}`}.`}</p>
                {v.state.build?.model && v.state.build.status !== 'running' && (
                  <p className="text-xs text-muted-foreground">Built with {v.state.build.engine === 'free' ? `the free pool (${v.state.build.model})` : `${v.state.build.model}${v.state.build.effort ? ` · effort ${v.state.build.effort}` : ''}`}{v.state.build.manual ? ', started here' : ''}.</p>
                )}
                {(v.state.milestonesDone ?? []).length > 0 && <p className="text-xs text-muted-foreground">Merged: {v.state.milestonesDone!.join(', ')}</p>}
                {v.state.revenue && <p className="text-xs text-muted-foreground">MRR ${v.state.revenue.mrr.toFixed(2)}</p>}
                {v.stage !== 'live' && (
                  <div className="pt-2">
                    <BuildNow
                      slug={v.slug}
                      name={shortTitle(v.title)}
                      target={buildTarget}
                      steps={buildSteps}
                      mvp={{ target: mvpTarget, steps: mvpSteps }}
                      golive={{ target: liveTarget, steps: liveSteps }}
                      request={lastRequest ? { id: lastRequest.id, status: lastRequest.status, label: buildRequestLabel(lastRequest), createdAt: lastRequest.createdAt.toISOString(), prUrl: safeUrl(lastRequest.prUrl), note: lastRequest.note } : null}
                      blocked={overview.buildRequestsMissing ? 'Start build now needs the idea_build_requests table (npm run db:push).' : null}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(repo || v.state.launch) && v.stage !== 'pass' && <RevenueCard launch={v.state.launch} hasRepo={!!repo} />}

          {(v.state.funnel || v.state.growth) && v.stage !== 'pass' && <GrowthCard funnel={v.state.funnel} growth={v.state.growth} focus={!!policy?.growth?.focus?.includes(v.slug)} />}

          {v.idea.overlaps && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Overlap with your repos</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{v.idea.overlaps}</CardContent>
            </Card>
          )}

          {v.decisions.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Decisions</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs">
                  {v.decisions.slice(0, 8).map(d => (
                    <li key={d.id}>
                      <span className="font-medium">{DECISION_LABEL[d.decision]}</span>{' '}
                      <span className={cn(d.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{d.status}</span>{' '}
                      <span className="text-muted-foreground" suppressHydrationWarning>{formatDistanceToNow(d.createdAt, now.getTime())}</span>
                      {d.result && <p className="text-muted-foreground">{d.result}</p>}
                      {d.note && <p className="italic">“{d.note}”</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <p className="text-[11px] text-muted-foreground px-1">
            Keys: A approve · T demand test · P pass · ← → previous / next to review · Esc back.
            {v.updatedAt && <> Record updated {formatDistanceToNow(v.updatedAt, now.getTime())}.</>}
          </p>
        </aside>
      </div>
    </div>
  )
}

function ExtLink({ href, icon: Icon, children }: { href: string; icon: typeof Globe; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
      <Icon className="h-3.5 w-3.5" />{children}
    </a>
  )
}

/** The gstack review at a glance: verdict, forcing questions, wedge, feasibility, risks, kill criteria. */
function ReviewCard({ v }: { v: IdeaView }) {
  const r = v.review!
  const feas = r.feasibility
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">The review{v.state.review?.at ? <span className="text-xs font-normal text-muted-foreground ml-2">{new Date(v.state.review.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : null}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {r.summary && <p className="text-sm leading-relaxed">{r.summary}</p>}
        <ForcingQuestions review={r} />
        {r.wedge && <Field label="Narrowest wedge">{r.wedge}</Field>}
        {feas && (
          <Field label="Feasibility">
            <span className="inline-flex flex-wrap gap-1.5 mb-1">
              <Badge variant="outline" className={feas.zeroCost ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{feas.zeroCost ? '✓' : '✗'} $0 to run</Badge>
              <Badge variant="outline" className={feas.m1Weekend ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{feas.m1Weekend ? '✓' : '✗'} M1 in a weekend</Badge>
            </span>
            {feas.notes && <span className="block">{feas.notes}</span>}
          </Field>
        )}
        {(r.risks ?? []).length > 0 && (
          <Field label="Risks"><ul className="list-disc pl-4 space-y-0.5">{r.risks!.map(x => <li key={x}>{x}</li>)}</ul></Field>
        )}
        {r.killCriteria && <Field label="Kill criteria">{r.killCriteria}</Field>}
        {((r.premises ?? []).length > 0 || (r.alternatives ?? []).length > 0) && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Premises and alternatives</summary>
            <div className="grid gap-4 sm:grid-cols-2 mt-3">
              {(r.premises ?? []).length > 0 && <Field label="Premises"><ul className="list-disc pl-4 space-y-0.5">{r.premises!.map(x => <li key={x}>{x}</li>)}</ul></Field>}
              {(r.alternatives ?? []).length > 0 && <Field label="Alternatives"><ul className="list-disc pl-4 space-y-0.5">{r.alternatives!.map(x => <li key={x}>{x}</li>)}</ul></Field>}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}
