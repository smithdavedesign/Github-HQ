'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HealthBadge } from '@/components/repos/health-badge'
import { triageSetLifecycle } from '@/lib/actions/repositories'
import { formatDistanceToNow } from '@/lib/utils'
import { toast } from 'sonner'
import { CheckCircle, Archive, Skull, SkipForward, ChevronLeft, ChevronRight, Trophy } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export interface TriageRepo {
  id: number
  name: string
  description: string | null
  language: string | null
  stars: number
  lifecycleStatus: string | null
  archiveScore: number
  healthScore: number
  lastPush: Date | null
  purpose: string | null
}

interface Props {
  repos: TriageRepo[]
}

interface Decision {
  repoId: number
  action: 'keep' | 'sunset' | 'archive' | 'skip'
}

const ACTION_MAP = {
  keep:    { lifecycle: 'maintaining', label: 'Keep',    icon: CheckCircle, color: 'bg-emerald-600 hover:bg-emerald-700', key: 'k' },
  sunset:  { lifecycle: 'sunsetting',  label: 'Sunset',  icon: Skull,       color: 'bg-amber-600 hover:bg-amber-700',   key: 's' },
  archive: { lifecycle: 'archived',    label: 'Archive', icon: Archive,     color: 'bg-slate-600 hover:bg-slate-700',   key: 'a' },
  skip:    { lifecycle: null,          label: 'Skip',    icon: SkipForward, color: 'bg-muted hover:bg-muted/80 text-foreground', key: ' ' },
}

export function TriageView({ repos }: Props) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const current = repos[index]
  const total = repos.length
  const progress = Math.round((index / total) * 100)

  const handleAction = useCallback(async (action: keyof typeof ACTION_MAP) => {
    if (!current || saving) return
    setSaving(true)

    const lifecycle = ACTION_MAP[action].lifecycle
    if (lifecycle) {
      try {
        await triageSetLifecycle(current.id, lifecycle)
      } catch (err) {
        console.error('[triage] lifecycle update failed:', err)
        toast.error('Failed to save — try again')
        setSaving(false)
        return
      }
    }

    if (action !== 'skip') {
      toast.success(`${current.name} → ${ACTION_MAP[action].label}`, { duration: 1500 })
    }

    setDecisions(d => [...d, { repoId: current.id, action }])

    if (index + 1 >= total) {
      setDone(true)
    } else {
      setIndex(i => i + 1)
    }
    setSaving(false)
  }, [current, index, total, saving])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (done) return
      const key = e.key.toLowerCase()
      if (key === 'k') handleAction('keep')
      else if (key === 's') handleAction('sunset')
      else if (key === 'a') handleAction('archive')
      else if (key === ' ') { e.preventDefault(); handleAction('skip') }
      else if (key === 'arrowleft' && index > 0) setIndex(i => i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAction, done, index])

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Trophy className="w-12 h-12 text-emerald-500 mb-4" />
        <h2 className="text-xl font-bold">Portfolio is clean</h2>
        <p className="text-muted-foreground text-sm mt-2">No repos need triaging right now.</p>
        <Link href="/" className="mt-6 text-sm underline text-muted-foreground hover:text-foreground">← Back to dashboard</Link>
      </div>
    )
  }

  if (done) {
    const kept     = decisions.filter(d => d.action === 'keep').length
    const sunsetted = decisions.filter(d => d.action === 'sunset').length
    const archived = decisions.filter(d => d.action === 'archive').length
    const skipped  = decisions.filter(d => d.action === 'skip').length

    return (
      <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
        <Trophy className="w-12 h-12 text-emerald-500 mb-4" />
        <h2 className="text-xl font-bold">Triage complete</h2>
        <p className="text-muted-foreground text-sm mt-1">You reviewed {total} repos</p>
        <div className="grid grid-cols-2 gap-3 mt-6 w-full text-sm">
          {kept     > 0 && <Stat label="Kept"     value={kept}      color="text-emerald-500" />}
          {sunsetted > 0 && <Stat label="Sunsetted" value={sunsetted} color="text-amber-500" />}
          {archived > 0 && <Stat label="Archived"  value={archived}  color="text-slate-400" />}
          {skipped  > 0 && <Stat label="Skipped"   value={skipped}   color="text-muted-foreground" />}
        </div>
        <div className="flex gap-3 mt-8">
          <Button variant="outline" onClick={() => router.push('/repos/graveyard')}>View graveyard</Button>
          <Button onClick={() => router.push('/')}>Back to dashboard</Button>
        </div>
      </div>
    )
  }

  const archiveRisk = current.archiveScore >= 70 ? 'high' : current.archiveScore >= 40 ? 'medium' : 'low'

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{index + 1} of {total} repos</span>
          <span>{total - index - 1} remaining</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Repo card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/repos/${current.id}`} target="_blank" className="text-lg font-bold hover:underline">
                {current.name}
              </Link>
              {current.lifecycleStatus && (
                <Badge variant="outline" className="text-xs">{current.lifecycleStatus}</Badge>
              )}
              {current.purpose && (
                <Badge variant="secondary" className="text-xs">{current.purpose}</Badge>
              )}
            </div>
            {current.description && (
              <p className="text-sm text-muted-foreground mt-1">{current.description}</p>
            )}
          </div>
          <HealthBadge score={Math.round(current.healthScore)} />
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {current.language && <span>{current.language}</span>}
          {current.stars > 0 && <span>⭐ {current.stars}</span>}
          {current.lastPush && <span>Last push {formatDistanceToNow(current.lastPush)}</span>}
          <span className={`font-medium ${archiveRisk === 'high' ? 'text-red-400' : archiveRisk === 'medium' ? 'text-amber-400' : 'text-emerald-400'}`}>
            Archive risk: {archiveRisk} ({Math.round(current.archiveScore)})
          </span>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-4 gap-2 pt-2">
          {(Object.entries(ACTION_MAP) as [keyof typeof ACTION_MAP, typeof ACTION_MAP[keyof typeof ACTION_MAP]][]).map(([action, meta]) => {
            const Icon = meta.icon
            return (
              <button
                key={action}
                onClick={() => handleAction(action)}
                disabled={saving}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg text-white text-xs font-medium transition-colors ${meta.color} disabled:opacity-50`}
              >
                <Icon className="w-4 h-4" />
                <span>{meta.label}</span>
                <span className="text-[10px] opacity-60">[{meta.key === ' ' ? 'space' : meta.key}]</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          className="flex items-center gap-1 hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Previous
        </button>
        <span className="text-[10px]">K = Keep · S = Sunset · A = Archive · Space = Skip</span>
        <button
          onClick={() => handleAction('skip')}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
