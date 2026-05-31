'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'
import { analyzeRepo } from '@/lib/actions/repositories'
import { toast } from 'sonner'

export function AnalyzeButton({ repoId }: { repoId: number }) {
  const [loading, setLoading] = useState(false)

  async function handleAnalyze() {
    setLoading(true)
    try {
      await analyzeRepo(repoId)
      toast.success('Analysis started — results will appear in 10–30 seconds')
    } catch {
      toast.error('Failed to start analysis')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={loading} className="gap-1.5">
      <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
      {loading ? 'Analyzing…' : 'Analyze with Claude'}
    </Button>
  )
}
