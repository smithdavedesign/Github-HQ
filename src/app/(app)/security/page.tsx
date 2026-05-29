import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { securityFindings, repositories } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { MetricCard } from '@/components/dashboard/metric-card'
import { Shield, AlertTriangle, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from '@/lib/utils'
import { redirect } from 'next/navigation'

async function getSecurityData(userId: string) {
  const findings = await db
    .select({
      id: securityFindings.id,
      type: securityFindings.type,
      severity: securityFindings.severity,
      title: securityFindings.title,
      packageName: securityFindings.packageName,
      state: securityFindings.state,
      createdAt: securityFindings.createdAt,
      repoName: repositories.name,
      repoId: repositories.id,
    })
    .from(securityFindings)
    .innerJoin(repositories, eq(securityFindings.repoId, repositories.id))
    .where(
      and(
        eq(repositories.userId, userId),
        eq(securityFindings.state, 'open'),
      ),
    )
    .orderBy(
      sql`case ${securityFindings.severity}
        when 'critical' then 1
        when 'high' then 2
        when 'medium' then 3
        when 'low' then 4
        else 5 end`
    )

  return findings
}

export default async function SecurityPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const findings = await getSecurityData(session.user.id)

  const critical = findings.filter((f) => f.severity === 'critical').length
  const high = findings.filter((f) => f.severity === 'high').length
  const medium = findings.filter((f) => f.severity === 'medium').length
  const low = findings.filter((f) => f.severity === 'low').length

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400'
      case 'high': return 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400'
      case 'medium': return 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400'
      default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400'
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Dependabot alerts and secret scanning across all repositories
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard title="Critical" value={critical} icon={Shield} variant={critical > 0 ? 'danger' : 'default'} />
        <MetricCard title="High" value={high} icon={AlertTriangle} variant={high > 0 ? 'danger' : 'default'} />
        <MetricCard title="Medium" value={medium} icon={AlertTriangle} variant={medium > 0 ? 'warning' : 'default'} />
        <MetricCard title="Low" value={low} icon={Info} variant="default" />
      </div>

      <Card>
        <CardContent className="p-0">
          {findings.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No open security findings. 🎉
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Severity</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Repository</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Type</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Title</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f) => (
                    <tr key={f.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`capitalize text-xs ${severityColor(f.severity)}`}>
                          {f.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium">{f.repoName}</td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{f.type}</td>
                      <td className="px-4 py-3 max-w-sm">
                        <p className="truncate">{f.title}</p>
                        {f.packageName && (
                          <p className="text-xs text-muted-foreground">{f.packageName}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatDistanceToNow(f.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
