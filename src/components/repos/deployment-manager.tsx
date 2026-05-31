'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, Plus, Trash2, Search, CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react'
import { addDeploymentUrl, removeDeploymentUrl, checkSingleDeployment, discoverRepoDeployments } from '@/lib/actions/deployments'
import { toast } from 'sonner'
import { formatDistanceToNow } from '@/lib/utils'
import type { Deployment } from '@/lib/db/schema'

const PROVIDER_LABELS: Record<string, string> = {
  vercel: 'Vercel',
  netlify: 'Netlify',
  render: 'Render',
  railway: 'Railway',
  fly: 'Fly.io',
  'github-pages': 'GitHub Pages',
  aws: 'AWS',
  azure: 'Azure',
  custom: 'Custom',
}

function StatusIcon({ status }: { status: string | null }) {
  if (status === 'healthy') return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
  if (status === 'slow') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
  if (status === 'down') return <XCircle className="w-3.5 h-3.5 text-red-500" />
  return <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30" />
}

interface Props {
  repoId: number
  initialDeployments: Deployment[]
}

export function DeploymentManager({ repoId, initialDeployments }: Props) {
  const [deps, setDeps] = useState(initialDeployments)
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [checkingId, setCheckingId] = useState<number | null>(null)

  async function handleAdd() {
    if (!newUrl.trim()) return
    setAdding(true)
    try {
      const dep = await addDeploymentUrl(repoId, newUrl.trim())
      setDeps(prev => [...prev, dep])
      setNewUrl('')
      toast.success('Deployment URL added and checked')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add URL')
    } finally {
      setAdding(false)
    }
  }

  async function handleDiscover() {
    setDiscovering(true)
    try {
      const result = await discoverRepoDeployments(repoId)
      toast.success(`Discovered ${result.discovered} URL${result.discovered !== 1 ? 's' : ''}, added ${result.added} new`)
      // Refresh page to show new deployments
      window.location.reload()
    } catch {
      toast.error('Discovery failed — check GitHub permissions')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleRemove(id: number) {
    try {
      await removeDeploymentUrl(id)
      setDeps(prev => prev.filter(d => d.id !== id))
      toast.success('Removed')
    } catch {
      toast.error('Failed to remove')
    }
  }

  async function handleCheck(id: number) {
    setCheckingId(id)
    try {
      await checkSingleDeployment(id)
      toast.success('Check complete — refresh to see updated status')
    } catch {
      toast.error('Check failed')
    } finally {
      setCheckingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-2 flex-1 min-w-64">
          <Input
            placeholder="https://myapp.vercel.app"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8 gap-1" onClick={handleAdd} disabled={adding || !newUrl.trim()}>
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </Button>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1" onClick={handleDiscover} disabled={discovering}>
          {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {discovering ? 'Discovering…' : 'Auto-discover'}
        </Button>
      </div>

      {/* Deployments list */}
      {deps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No deployment URLs configured. Add one above or click <strong>Auto-discover</strong> to check GitHub Environments and Pages.
        </p>
      ) : (
        <div className="space-y-2">
          {deps.map((dep) => (
            <Card key={dep.id} className="p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusIcon status={dep.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={dep.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium hover:underline flex items-center gap-1 truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {dep.url.replace(/^https?:\/\//, '')}
                    </a>
                    {dep.name && (
                      <Badge variant="secondary" className="text-xs">{dep.name}</Badge>
                    )}
                    {dep.provider && dep.provider !== 'custom' && (
                      <Badge variant="outline" className="text-xs">{PROVIDER_LABELS[dep.provider] ?? dep.provider}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dep.lastChecked ? `Checked ${formatDistanceToNow(dep.lastChecked)}` : 'Not checked yet'}
                    {dep.responseTimeMs && ` · ${dep.responseTimeMs}ms`}
                    {dep.sslValid !== null && ` · SSL ${dep.sslValid ? '✓' : '✗'}`}
                    {dep.httpStatus && ` · HTTP ${dep.httpStatus}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleCheck(dep.id)}
                    disabled={checkingId === dep.id}
                  >
                    {checkingId === dep.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-destructive hover:text-destructive"
                    onClick={() => handleRemove(dep.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
