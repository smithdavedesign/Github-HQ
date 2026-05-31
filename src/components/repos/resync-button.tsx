'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { resyncRepo } from '@/lib/actions/repositories'
import { toast } from 'sonner'

export function ResyncButton({ repoId }: { repoId: number }) {
  const [loading, setLoading] = useState(false)

  async function handleResync() {
    setLoading(true)
    try {
      await resyncRepo(repoId)
      toast.success('Re-syncing repo — data will update in a moment')
    } catch {
      toast.error('Failed to start re-sync')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleResync} disabled={loading} className="gap-1.5">
      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Syncing…' : 'Re-sync'}
    </Button>
  )
}
