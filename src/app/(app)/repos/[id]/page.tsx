import { getRepositoryById, getSkillRunHistory } from '@/lib/actions/repositories'
import { getLLMSettings } from '@/lib/actions/llm'
import { PROVIDER_SHORT_NAME } from '@/lib/ai/providers'
import { getLatestAdvisorContent } from '@/lib/actions/repositories'
import { getMyAccuracyStats } from '@/lib/actions/advisor-accuracy'
import { RepoAdvisorSection } from '@/components/repos/repo-advisor-section'
import { GstackSkillLauncher } from '@/components/repos/gstack-skill-launcher'
import { SkillReportFindings } from '@/components/repos/skill-report-findings'
import type { GstackSkill } from '@/lib/actions/nexus'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { and, eq, inArray, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { HealthBadge, ActivityBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExternalLink, GitFork, Star, AlertTriangle, Lock, Globe, CheckCircle, XCircle, Clock, Bot, GitPullRequest, GitMerge } from 'lucide-react'
// ExternalLink used in header homepage link
import { formatDistanceToNow } from '@/lib/utils'
import { CommitActivityChart } from '@/components/repos/commit-activity-chart'
import { TagEditor } from '@/components/repos/tag-editor'
import { RevenueEditor } from '@/components/repos/revenue-editor'
import { CostItemsEditor } from '@/components/repos/cost-items-editor'
import { ResyncButton } from '@/components/repos/resync-button'
import { AnalyzeButton } from '@/components/repos/analyze-button'
import { AnalysisTab } from '@/components/repos/analysis-tab'
import { DeploymentManager } from '@/components/repos/deployment-manager'
import { LifecycleSelector } from '@/components/repos/lifecycle-selector'
import { EffortSelector } from '@/components/repos/effort-selector'
import { RepoPL } from '@/components/repos/repo-pl'
import { PurposeSelector } from '@/components/repos/purpose-selector'
import { FocusToggle } from '@/components/repos/focus-toggle'
import type { ClaudeAnalysis } from '@/lib/ai/analysis'
import type { CostItem } from '@/lib/db/schema'

type Props = { params: Promise<{ id: string }> }

export default async function RepoDetailPage({ params }: Props) {
  const { id } = await params
  const repoId = Number(id)
  const [repo, agentHistory, llmSettings, advisor, accuracyStats, skillHistory] = await Promise.all([
    getRepositoryById(repoId),
    db.query.portfolioEvents.findMany({
      where: and(
        eq(portfolioEvents.repoId, repoId),
        inArray(portfolioEvents.eventType, ['agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_pr_rejected', 'agent_execution_failed', 'agent_attempt', 'agent_skill_report']),
      ),
      orderBy: [desc(portfolioEvents.occurredAt)],
      limit: 30,
    }),
    getLLMSettings(),
    getLatestAdvisorContent().catch(() => null),
    getMyAccuracyStats().catch(() => []),
    getSkillRunHistory(repoId),
  ])
  if (!repo) notFound()

  const metrics = repo.metrics
  const stack = repo.techStack
  const summary = repo.aiSummary as {
    what_it_does?: string
    maturity?: string
    risk?: string
    recommendations?: string[]
  } | null

  const openFindings = repo.securityFindings.filter((f) => f.state === 'open')
  const criticalCount = openFindings.filter((f) => f.severity === 'critical').length
  const highCount = openFindings.filter((f) => f.severity === 'high').length

  const weeklyCommitData = metrics?.weeklyCommitData as { week: number; total: number }[] | null
  const claudeAnalysis = repo.claudeAnalysis as ClaudeAnalysis | null
  const analysisIsStale = !!(
    repo.claudeAnalysisAt &&
    metrics?.lastPush &&
    new Date(metrics.lastPush) > new Date(repo.claudeAnalysisAt)
  )

  function BuildStatusBadge({ status }: { status: string | null }) {
    if (!status) return <span className="text-muted-foreground text-xs">—</span>
    const icon = status === 'success' ? <CheckCircle className="w-3 h-3" />
      : status === 'failure' ? <XCircle className="w-3 h-3" />
        : <Clock className="w-3 h-3" />
    const color = status === 'success' ? 'text-emerald-600 dark:text-emerald-400'
      : status === 'failure' ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400'
    return (
      <span className={`flex items-center gap-1 text-xs font-medium capitalize ${color}`}>
        {icon} {status.replace(/_/g, ' ')}
      </span>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
            <a
              href={`https://github.com/${repo.fullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Open on GitHub"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <Badge variant="outline" className="gap-1 text-xs">
              {repo.visibility === 'private' ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
              {repo.visibility}
            </Badge>
            {metrics?.healthScore != null && <HealthBadge score={metrics.healthScore} />}
          </div>
          {repo.description && (
            <p className="text-muted-foreground text-sm mt-1 max-w-xl">{repo.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Star className="w-3 h-3" /> {repo.stars}</span>
            <span className="flex items-center gap-1"><GitFork className="w-3 h-3" /> {repo.forks}</span>
            {repo.homepage && (
              <a href={repo.homepage} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
                <ExternalLink className="w-3 h-3" /> {repo.homepage.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {metrics?.activityStatus && <ActivityBadge status={metrics.activityStatus} />}
          <AnalyzeButton
            repoId={repo.id}
            hasExistingAnalysis={!!claudeAnalysis}
            isStale={analysisIsStale}
            providerName={PROVIDER_SHORT_NAME[llmSettings.provider as keyof typeof PROVIDER_SHORT_NAME] ?? 'Claude'}
          />
          <ResyncButton repoId={repo.id} />
        </div>
      </div>

      {/* Metrics row */}
      {metrics && (
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
          {[
            { label: 'Health', value: metrics.healthScore ?? '—' },
            { label: 'Activity', value: metrics.activityScore ?? '—' },
            { label: 'Security', value: metrics.securityScore ?? '—' },
            { label: 'Docs', value: metrics.documentationScore ?? '—' },
            { label: 'Testing', value: metrics.testingScore ?? '—' },
            { label: 'Issues', value: metrics.openIssues ?? 0 },
            { label: 'PRs', value: metrics.openPrs ?? 0 },
          ].map(({ label, value }) => (
            <Card key={label} className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold mt-0.5">{typeof value === 'number' ? Math.round(value) : value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="agent">
        <TabsList className="flex-nowrap overflow-x-auto h-auto scrollbar-none w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stack">Tech Stack</TabsTrigger>
          <TabsTrigger value="analysis">
            Analysis
            {claudeAnalysis && <span className="ml-1 text-xs text-emerald-500">✓</span>}
          </TabsTrigger>
          <TabsTrigger value="security">
            Security
            {openFindings.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">{openFindings.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="ai">AI Summary</TabsTrigger>
          <TabsTrigger value="agent">
            Agent
            {agentHistory.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">{agentHistory.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Last Push</p>
              <p className="font-medium">{formatDistanceToNow(metrics?.lastPush ?? null)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Monthly Commits</p>
              <p className="font-medium">{metrics?.monthlyCommits ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Build Status</p>
              <BuildStatusBadge status={metrics?.buildStatus ?? null} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Default Branch</p>
              <p className="font-medium">{repo.defaultBranch ?? 'main'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Language</p>
              <p className="font-medium">{repo.language ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Created</p>
              <p className="font-medium">{formatDistanceToNow(repo.createdAt)}</p>
            </div>
          </div>

          {/* Commit activity chart */}
          {weeklyCommitData && weeklyCommitData.length > 0 && (
            <CommitActivityChart data={weeklyCommitData} />
          )}

          {/* Lifecycle + Purpose + Effort + Focus + Tags */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Lifecycle Stage</p>
              <LifecycleSelector repoId={repo.id} repoName={repo.name} current={repo.lifecycleStatus} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Purpose</p>
              <PurposeSelector repoId={repo.id} current={repo.purpose} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Effort to Improve</p>
              <EffortSelector repoId={repo.id} current={repo.estimatedEffort} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Focus</p>
              <FocusToggle repoId={repo.id} initialFocused={repo.isFocused ?? false} />
              <p className="text-xs text-muted-foreground mt-1">Prioritised by Advisor and CEO Report.</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground mb-2">Tags</p>
              <TagEditor repoId={repo.id} initialTags={repo.tags ?? []} />
            </div>
          </div>
        </TabsContent>

        {/* Tech Stack */}
        <TabsContent value="stack" className="pt-4">
          {!stack ? (
            <p className="text-muted-foreground text-sm">No tech stack data yet. Sync to detect.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: 'Frontend', value: stack.frontend },
                { label: 'Backend', value: stack.backend },
                { label: 'Database', value: stack.database },
                { label: 'Hosting', value: stack.hosting },
                { label: 'Language', value: stack.language },
                { label: 'Testing', value: stack.testing },
                { label: 'Analytics', value: stack.analytics },
                { label: 'AI Tools', value: stack.aiTools },
                { label: 'CI/CD', value: stack.ciCd },
              ].map(({ label, value }) => (
                <Card key={label} className="p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium mt-0.5 text-sm">{value ?? '—'}</p>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Analysis */}
        <TabsContent value="analysis" className="pt-4">
          <AnalysisTab analysis={claudeAnalysis} repoId={repo.id} analysisAt={repo.claudeAnalysisAt} />
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="pt-4">
          {openFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open security findings.</p>
          ) : (
            <div className="space-y-3">
              {(criticalCount > 0 || highCount > 0) && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  {criticalCount > 0 && `${criticalCount} critical`}
                  {criticalCount > 0 && highCount > 0 && ', '}
                  {highCount > 0 && `${highCount} high`}
                  {' '}severity issues
                </div>
              )}
              <div className="rounded-md border overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left font-medium text-muted-foreground px-4 py-2">Severity</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-2">Type</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-2">Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openFindings.map((f) => {
                      const severityColor = f.severity === 'critical' ? 'text-red-600 dark:text-red-400'
                        : f.severity === 'high' ? 'text-orange-600 dark:text-orange-400'
                          : f.severity === 'medium' ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-400'
                      return (
                        <tr key={f.id} className="border-t">
                          <td className={`px-4 py-2 font-medium capitalize ${severityColor}`}>{f.severity}</td>
                          <td className="px-4 py-2 text-muted-foreground capitalize">{f.type}</td>
                          <td className="px-4 py-2">{f.title}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Deployments */}
        <TabsContent value="deployments" className="pt-4">
          <DeploymentManager repoId={repo.id} initialDeployments={repo.deployments} />
        </TabsContent>

        {/* Revenue */}
        <TabsContent value="revenue" className="pt-4 space-y-6">
          <RepoPL
            mrr={repo.mrr}
            monthlyCost={repo.monthlyCost}
            costItems={repo.costItems as CostItem[] | null}
          />
          <RevenueEditor
            repoId={repo.id}
            initialMrr={String(repo.mrr ?? '0')}
            initialArr={String(repo.arr ?? '0')}
            initialMonthlyCost={String(repo.monthlyCost ?? '0')}
          />
          <div>
            <p className="text-sm font-medium mb-3">Cost Breakdown</p>
            <CostItemsEditor
              repoId={repo.id}
              initialItems={repo.costItems as CostItem[] | null}
            />
          </div>
        </TabsContent>

        {/* AI Summary */}
        <TabsContent value="ai" className="pt-4">
          {!summary ? (
            <p className="text-sm text-muted-foreground">
              AI summary not generated yet. It will be generated on the next weekly refresh.
            </p>
          ) : (
            <div className="space-y-4">
              <Card className="p-4 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">What it does</p>
                  <p className="text-sm mt-1">{summary.what_it_does}</p>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Maturity</p>
                    <Badge variant="outline" className="mt-1">{summary.maturity}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Risk</p>
                    <Badge variant="outline" className={`mt-1 ${summary.risk === 'High' ? 'border-red-500 text-red-600' : summary.risk === 'Medium' ? 'border-amber-500 text-amber-600' : 'border-emerald-500 text-emerald-600'}`}>
                      {summary.risk}
                    </Badge>
                  </div>
                </div>
              </Card>
              {summary.recommendations && summary.recommendations.length > 0 && (
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Recommendations</p>
                  <ol className="space-y-1.5">
                    {summary.recommendations.map((rec, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                        {rec}
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Agent tab — Advisory + History */}
        <TabsContent value="agent" className="pt-4 space-y-6">
          {/* gstack Skill Launcher */}
          {(() => {
            const nexusConfigured = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)
            const openAlerts = repo.securityFindings?.filter(f => f.state === 'open' && ['critical','high'].includes(f.severity ?? '')) ?? []
            const failingBuild = repo.metrics?.buildStatus === 'failure'
            const repoActions = advisor?.actions?.filter(a => a.repoId === repoId) ?? []

            const defaultObjectives: Record<GstackSkill, string> = {
              investigate: failingBuild
                ? `Investigate why the build is failing in ${repo.name} and fix the root cause`
                : openAlerts.length > 0
                  ? `Investigate ${openAlerts.length} critical/high security alert${openAlerts.length > 1 ? 's' : ''} in ${repo.name}`
                  : `Investigate code quality issues and potential improvements in ${repo.name}`,
              review:             `Review the latest changes before merging in ${repo.name}`,
              'qa-only':          `Find bugs in ${repo.name} and report them with repro steps`,
              qa:                 `Find and fix bugs in ${repo.name}`,
              ship:               repoActions[0]?.action ?? `Ship latest changes in ${repo.name}`,
              'document-release': `Update README and docs to match what was shipped in ${repo.name}`,
              health:             `Run code health check on ${repo.name} — report TypeScript errors, test failures, dead code, and lint issues`,
              canary:             repo.homepage ? `Check ${repo.homepage} for console errors and performance issues` : `Monitor ${repo.name} deployments for errors`,
              retro:              `Summarise this week's commits and engineering patterns in ${repo.name}`,
            }

            return (
              <GstackSkillLauncher
                repoId={repoId}
                repoName={repo.name}
                repoHomepage={repo.homepage}
                defaultObjectives={defaultObjectives}
                nexusEnabled={nexusConfigured}
                skillHistory={skillHistory}
              />
            )
          })()}

          {/* AI Repo Advisory */}
          <RepoAdvisorSection
            actions={advisor?.actions?.filter(a => a.repoId === repoId) ?? []}
            nexusEnabled={!!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)}
            generatedAt={advisor?.generatedAt}
            accuracyStats={accuracyStats}
          />

          {/* Activity history */}
          <div className="space-y-2">
            <p id="agent-history" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide scroll-mt-4">Agent History</p>
          {agentHistory.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <Bot className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No agent activity yet</p>
              <p className="text-xs mt-1">Queue an advisor action above to run the agent on this repo</p>
            </div>
          ) : (
            <div className="space-y-2">
              {agentHistory.map(event => {
                const meta = event.metadata as Record<string, unknown> | null
                const prUrl = meta?.prUrl as string | undefined
                const predictedDelta = meta?.predictedDelta as string | undefined
                const actualDelta = meta?.actualDelta as number | undefined

                const isQueued   = event.eventType === 'agent_task_queued'
                const isCreated  = event.eventType === 'agent_pr_created'
                const isMerged   = event.eventType === 'agent_pr_merged'
                const isRejected = event.eventType === 'agent_pr_rejected'
                const isFailed   = event.eventType === 'agent_execution_failed'
                const isAttempt  = event.eventType === 'agent_attempt'
                const isReport   = event.eventType === 'agent_skill_report'
                const attemptOutcome = isAttempt ? (meta?.outcome as string | undefined) : undefined

                const Icon = isMerged ? GitMerge : isRejected ? XCircle : isCreated ? GitPullRequest : isQueued ? Clock : Bot
                const iconColor = isMerged ? 'text-emerald-500'
                  : isRejected ? 'text-muted-foreground'
                  : isCreated ? 'text-blue-500'
                  : isFailed ? 'text-red-400'
                  : isReport ? 'text-violet-500'
                  : isAttempt && attemptOutcome === 'success' ? 'text-emerald-500'
                  : isAttempt && attemptOutcome === 'failed' ? 'text-red-400'
                  : isAttempt ? 'text-amber-500'
                  : 'text-muted-foreground'
                const label = isQueued ? 'Queued'
                  : isCreated ? 'PR Created'
                  : isMerged ? 'Merged'
                  : isRejected ? 'PR Closed — Not Merged'
                  : isReport ? `/${(meta?.skillName as string) ?? 'skill'} Report`
                  : isAttempt ? `Attempt: ${attemptOutcome ?? '?'}`
                  : 'Failed'
                const labelColor = isMerged
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200'
                  : isCreated
                    ? 'bg-blue-500/10 text-blue-600 border-blue-200'
                    : isFailed || attemptOutcome === 'failed'
                      ? 'bg-red-500/10 text-red-600 border-red-200'
                      : isAttempt && attemptOutcome === 'success'
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200'
                        : isAttempt
                          ? 'bg-amber-500/10 text-amber-600 border-amber-200'
                          : 'bg-muted text-muted-foreground border-border/60'

                const source = meta?.source as string | undefined
                const isAutoDispatched = source === 'repohq-auto-dispatch'
                const isMcpTriggered   = source === 'repohq-mcp-agent'

                return (
                  <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
                    <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] px-1.5 ${labelColor}`}>{label}</Badge>
                        {isAutoDispatched && (
                          <Badge variant="outline" className="text-[9px] px-1 h-4 bg-violet-50 text-violet-600 border-violet-200">Auto</Badge>
                        )}
                        {isMcpTriggered && (
                          <Badge variant="outline" className="text-[9px] px-1 h-4 bg-sky-50 text-sky-600 border-sky-200">MCP</Badge>
                        )}
                        <p className="text-sm font-medium truncate">{event.title}</p>
                      </div>
                      {event.description && (
                        isFailed ? (
                          <pre className="text-[10px] text-red-500/80 mt-1 bg-red-500/5 border border-red-500/10 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                            {event.description}
                          </pre>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5 break-words">{event.description}</p>
                        )
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                        {predictedDelta && <span>Predicted: {predictedDelta}</span>}
                        {actualDelta != null && (
                          <span className={actualDelta > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                            Actual: {actualDelta > 0 ? '+' : ''}{actualDelta} pts
                          </span>
                        )}
                        {typeof meta?.agentName === 'string' && <span>{meta.agentName}</span>}
                        {prUrl && (
                          <a href={prUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground flex items-center gap-0.5">
                            View PR <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      {/* Skill report findings — expandable full list + actionable queue buttons */}
                      {isReport && Array.isArray(meta?.findings) && (meta.findings as string[]).length > 0 && (
                        <SkillReportFindings
                          findings={meta.findings as string[]}
                          skillName={meta.skillName as string | undefined}
                          repoId={repoId}
                          repoName={repo.name}
                          nexusEnabled={!!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)}
                        />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(event.occurredAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
