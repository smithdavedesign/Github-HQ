import { getDeployments } from '@/lib/actions/deployments'
import { MetricCard } from '@/components/dashboard/metric-card'
import { Rocket, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from '@/lib/utils'

export default async function DeploymentsPage() {
  const deployments = await getDeployments()

  const healthy = deployments.filter((d) => d.status === 'healthy').length
  const slow = deployments.filter((d) => d.status === 'slow').length
  const down = deployments.filter((d) => d.status === 'down').length
  const unconfigured = 0 // repos without any deployment URL

  const statusBadge = (status: string | null) => {
    switch (status) {
      case 'healthy':
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1"><CheckCircle className="w-3 h-3" />Healthy</Badge>
      case 'slow':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs gap-1"><AlertTriangle className="w-3 h-3" />Slow</Badge>
      case 'down':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs gap-1"><XCircle className="w-3 h-3" />Down</Badge>
      default:
        return <Badge variant="outline" className="text-xs">Unknown</Badge>
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deployments</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Production URL uptime and response monitoring
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard title="Total Monitored" value={deployments.length} icon={Rocket} />
        <MetricCard title="Healthy" value={healthy} icon={CheckCircle} variant="success" />
        <MetricCard title="Slow" value={slow} icon={AlertTriangle} variant="warning" />
        <MetricCard title="Down" value={down} icon={XCircle} variant={down > 0 ? 'danger' : 'default'} />
      </div>

      <Card>
        <CardContent className="p-0">
          {deployments.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No deployments configured. Add a production URL on a repository detail page.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Repository</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">URL</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Status</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Response</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">SSL</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Last Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((dep) => (
                    <tr key={dep.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{dep.repository?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <a
                          href={dep.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400 truncate max-w-48 block"
                        >
                          {dep.url.replace(/^https?:\/\//, '')}
                        </a>
                      </td>
                      <td className="px-4 py-3">{statusBadge(dep.status)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {dep.responseTimeMs != null ? `${dep.responseTimeMs}ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {dep.sslValid === true
                          ? <span className="text-emerald-600">✓ Valid</span>
                          : dep.sslValid === false
                            ? <span className="text-red-600">✗ Invalid</span>
                            : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDistanceToNow(dep.lastChecked)}
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
