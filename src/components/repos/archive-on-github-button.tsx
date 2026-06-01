'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Archive, CheckCircle, Loader2 } from 'lucide-react'
import { archiveRepoOnGitHub } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface Props {
  repoId: number
  repoName: string
}

export function ArchiveOnGitHubButton({ repoId, repoName }: Props) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()

  async function handleArchive() {
    setLoading(true)
    try {
      const result = await archiveRepoOnGitHub(repoId)
      if (result.alreadyArchived) {
        toast.info(`${repoName} is already archived on GitHub`)
        setDone(true)
        return
      }
      toast.success(`${repoName} archived on GitHub — now read-only`)
      setDone(true)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive on GitHub')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
        <CheckCircle className="w-3.5 h-3.5" />
        Archived on GitHub
      </div>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleArchive}
      disabled={loading}
      className="gap-1.5 text-xs h-7 border-slate-300 text-slate-600 hover:bg-slate-50"
    >
      {loading
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : <Archive className="w-3.5 h-3.5" />}
      {loading ? 'Archiving…' : 'Archive on GitHub'}
    </Button>
  )
}
