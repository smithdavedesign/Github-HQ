'use client'

import { useQuery } from '@tanstack/react-query'
import { Progress } from '@/components/ui/progress'

interface ScanStatus {
  id: number
  status: string
  totalRepos: number | null
  processedRepos: number | null
  startedAt: string | null
  error: string | null
}

export function SyncProgress() {
  const { data } = useQuery<ScanStatus | null>({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await fetch('/api/sync-status')
      if (!res.ok) return null
      return res.json()
    },
    refetchInterval: (query) => {
      // Poll every 3s while running, stop when done
      return query.state.data?.status === 'running' ? 3000 : false
    },
    staleTime: 0,
  })

  if (!data || data.status !== 'running') return null

  const total = data.totalRepos ?? 0
  const processed = data.processedRepos ?? 0
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">
        Syncing {processed}/{total} repos
      </span>
      <Progress value={pct} className="w-24 h-1.5" />
      <span className="tabular-nums">{pct}%</span>
    </div>
  )
}
