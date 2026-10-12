import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { securityFindings, repositories, repositoryMetrics } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { MetricCard } from '@/components/dashboard/metric-card'
import { Shield, AlertTriangle, Info, ExternalLink, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from '@/lib/utils'
import { redirect } from 'next/navigation'
import { summarizeFindings, type RepoSecurity, type Severity } from '@/lib/security/summary'

export const metadata: Metadata = { title: 'Security' }

/** Open findings grouped by repo, package and severity: a few hundred rows instead of every alert. */
async function getFindingGroups(userId: string) {
  const noPackageTitle = sql`case when ${securityFindings.packageName} is null then ${securityFindings.title} end`
  return db
    .select({
      repoId: repositories.id,
      repoName: repositories.name,
      fullName: repositories.fullName,
      isArchived: repositories.isArchived,
      lifecycleStatus: repositories.lifecycleStatus,
      activityStatus: repositoryMetrics.activityStatus,
      packageName: securityFindings.packageName,
      type: securityFindings.type,
      severity: securityFindings.severity,
      count: sql<number>`count(*)`.mapWith(Number),
      newest: sql<Date | null>`max(${securityFindings.createdAt})`.mapWith(securityFindings.createdAt),
      title: sql<string>`min(${securityFindings.title})`,
    })
    .from(securityFindings)
    .innerJoin(repositories, eq(securityFindings.repoId, repositories.id))
    .leftJoin(repositoryMetrics, eq(repositoryMetrics.repoId, repositories.id))
    .where(and(eq(repositories.userId, userId), eq(securityFindings.state, 'open')))
    .groupBy(repositories.id, repositories.name, repositories.fullName, repositories.isArchived, repositories.lifecycleStatus,
      repositoryMetrics.activityStatus, securityFindings.packageName, noPackageTitle, securityFindings.type, securityFindings.severity)
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  low: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400',
}

function RepoRow({ r }: { r: RepoSecurity }) {
  return (
    <li className="px-4 py-3 border-t first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={`/repos/${r.repoId}`} className="font-medium hover:underline">{r.repoName}</Link>
        <span className="flex flex-wrap gap-1">
          {(['critical', 'high', 'medium', 'low'] as const).filter(s => r.counts[s] > 0).map(s => (
            <Badge key={s} variant="outline" className={`text-xs tabular-nums ${SEVERITY_STYLE[s]}`}>{r.counts[s]} {s}</Badge>
          ))}
        </span>
        {r.quietReason && <span className="text-xs text-muted-foreground">{r.quietReason}</span>}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {r.newest && <span>newest {formatDistanceToNow(r.newest)}</span>}
          <a href={`https://github.com/${r.fullName}/security/dependabot`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground">
            On GitHub <ExternalLink className="w-3 h-3" aria-hidden />
          </a>
        </span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Packages with alerts in ${r.repoName}`}>
        {r.packages.map(p => (
          <li key={p.name} title={p.title}
            className={`rounded border px-1.5 py-0.5 text-xs ${SEVERITY_STYLE[p.severity]}`}>
            {p.name}{p.count > 1 ? <span className="tabular-nums"> ×{p.count}</span> : null}
          </li>
        ))}
        {r.morePackages > 0 && <li className="px-1.5 py-0.5 text-xs text-muted-foreground">+{r.morePackages} more</li>}
      </ul>
    </li>
  )
}

export default async function SecurityPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { totals, active, quiet } = summarizeFindings(await getFindingGroups(session.user.id))
  const quietAlerts = quiet.reduce((n, r) => n + r.total, 0)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Open Dependabot and secret-scanning alerts, by repo. Hover a package for its advisory; each repo links to the full list on GitHub.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard title="Critical" value={totals.critical} icon={Shield} variant={totals.critical > 0 ? 'danger' : 'default'} />
        <MetricCard title="High" value={totals.high} icon={AlertTriangle} variant={totals.high > 0 ? 'danger' : 'default'} />
        <MetricCard title="Medium" value={totals.medium} icon={AlertTriangle} variant={totals.medium > 0 ? 'warning' : 'default'} />
        <MetricCard title="Low" value={totals.low} icon={Info} variant="default" />
      </div>

      {active.length + quiet.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No open security alerts.</CardContent></Card>
      ) : (
        <>
          <section aria-labelledby="sec-active">
            <h2 id="sec-active" className="text-sm font-semibold mb-2">
              Repos in use <span className="text-muted-foreground font-normal">· {active.length}</span>
            </h2>
            <Card>
              <CardContent className="p-0">
                {active.length
                  ? <ul>{active.map(r => <RepoRow key={r.repoId} r={r} />)}</ul>
                  : <p className="px-4 py-6 text-sm text-muted-foreground">No alerts in repos you&apos;re working on.</p>}
              </CardContent>
            </Card>
          </section>

          {quiet.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-sm font-semibold flex items-center gap-1.5">
                <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" aria-hidden />
                Dormant, sunsetting or archived
                <span className="text-muted-foreground font-normal">· {quiet.length} repos, {quietAlerts} alerts</span>
              </summary>
              <p className="text-xs text-muted-foreground mt-1 mb-2 ml-5.5">
                Nobody works on these, so their alerts can wait. Decide what to keep in <Link href="/repos/triage" className="underline">Triage</Link>.
              </p>
              <Card>
                <CardContent className="p-0"><ul>{quiet.map(r => <RepoRow key={r.repoId} r={r} />)}</ul></CardContent>
              </Card>
            </details>
          )}
        </>
      )}
    </div>
  )
}
