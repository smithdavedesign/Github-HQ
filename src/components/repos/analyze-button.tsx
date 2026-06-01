'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles, RefreshCw } from 'lucide-react'
import { analyzeRepo } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface Props {
  repoId: number
  hasExistingAnalysis: boolean
  isStale: boolean  // true when lastPush > claudeAnalysisAt (new commits since last analysis)
}

export function AnalyzeButton({ repoId, hasExistingAnalysis, isStale }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleAnalyze(force = false) {
    setLoading(true)
    try {
      const result = await analyzeRepo(repoId, force)
      if (result?.fromCache) {
        toast.info('Analysis is current — no new commits since last run', { duration: 3000 })
      } else {
        toast.success('Analysis started — results will appear in 10–30 seconds')
        setTimeout(() => router.refresh(), 15000)
      }
    } catch {
      toast.error('Failed to start analysis')
    } finally {
      setLoading(false)
    }
  }

  if (!hasExistingAnalysis) {
    return (
      <Button variant="outline" size="sm" onClick={() => handleAnalyze(false)} disabled={loading} className="gap-1.5">
        <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
        {loading ? 'Analyzing…' : 'Analyze with Claude'}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {isStale ? (
        <Button variant="outline" size="sm" onClick={() => handleAnalyze(false)} disabled={loading} className="gap-1.5 border-amber-500/50 text-amber-600 hover:bg-amber-50">
          <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
          {loading ? 'Analyzing…' : 'Re-analyze (new commits)'}
        </Button>
      ) : (
        <span className="text-xs text-emerald-600 font-medium">Analysis current</span>
      )}
      <Button variant="ghost" size="sm" onClick={() => handleAnalyze(true)} disabled={loading} className="gap-1.5 text-xs h-7 px-2">
        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        Force refresh
      </Button>
    </div>
  )
}
