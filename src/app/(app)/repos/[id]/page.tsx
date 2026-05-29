import { getRepositoryById } from '@/lib/actions/repositories'
import { notFound } from 'next/navigation'
import { HealthBadge, ActivityBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExternalLink, GitFork, Star, AlertTriangle, Lock, Globe } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'
type Props = { params: Promise<{ id: string }> }

export default async function RepoDetailPage({ params }: Props) {
  const { id } = await params
  const repo = await getRepositoryById(Number(id))
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
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
              <a
                href={repo.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> {repo.homepage.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {metrics?.activityStatus && <ActivityBadge status={metrics.activityStatus} />}
      </div>

      {/* Metrics row */}
      {metrics && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: 'Health', value: metrics.healthScore ?? '—' },
            { label: 'Activity', value: metrics.activityScore ?? '—' },
            { label: 'Security', value: metrics.securityScore ?? '—' },
            { label: 'Docs', value: metrics.documentationScore ?? '—' },
            { label: 'Testing', value: metrics.testingScore ?? '—' },
            { label: 'Open Issues', value: metrics.openIssues ?? 0 },
          ].map(({ label, value }) => (
            <Card key={label} className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold mt-0.5">{typeof value === 'number' ? Math.round(value) : value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stack">Tech Stack</TabsTrigger>
          <TabsTrigger value="security">
            Security
            {openFindings.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">
                {openFindings.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="ai">AI Summary</TabsTrigger>
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
              <p className="text-muted-foreground text-xs">Open PRs</p>
              <p className="font-medium">{metrics?.openPrs ?? '—'}</p>
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
          {repo.deployments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deployment URLs configured.</p>
          ) : (
            <div className="space-y-3">
              {repo.deployments.map((dep) => {
                const statusColor = dep.status === 'healthy' ? 'text-emerald-600 dark:text-emerald-400'
                  : dep.status === 'slow' ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
                return (
                  <Card key={dep.id} className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <a
                          href={dep.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-sm hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {dep.url}
                        </a>
                        <p className="text-xs text-muted-foreground mt-1">
                          Last checked {formatDistanceToNow(dep.lastChecked)}
                          {dep.responseTimeMs && ` · ${dep.responseTimeMs}ms`}
                        </p>
                      </div>
                      <span className={`text-sm font-medium capitalize ${statusColor}`}>
                        {dep.status ?? 'Unknown'}
                      </span>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
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
                    <Badge
                      variant="outline"
                      className={`mt-1 ${summary.risk === 'High' ? 'border-red-500 text-red-600' : summary.risk === 'Medium' ? 'border-amber-500 text-amber-600' : 'border-emerald-500 text-emerald-600'}`}
                    >
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
      </Tabs>
    </div>
  )
}
