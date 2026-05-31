'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { togglePublicProfile } from '@/lib/actions/repositories'
import { ExternalLink } from 'lucide-react'

interface PublicProfileToggleProps {
  enabled: boolean
  username: string | null | undefined
}

export function PublicProfileToggle({ enabled, username }: PublicProfileToggleProps) {
  const [isPublic, setIsPublic] = useState(enabled)
  const [loading, setLoading] = useState(false)

  async function handleToggle(next: boolean) {
    setLoading(true)
    try {
      await togglePublicProfile(next)
      setIsPublic(next)
      toast.success(next ? 'Public portfolio enabled' : 'Public portfolio disabled')
    } catch {
      toast.error('Failed to update')
    } finally {
      setLoading(false)
    }
  }

  const profileUrl = username ? `/u/${username}` : null

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Public portfolio</p>
        <p className="text-xs text-muted-foreground">
          Share a read-only view of your public repos at{' '}
          {profileUrl
            ? <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground inline-flex items-center gap-0.5">
                repohq.vercel.app/u/{username} <ExternalLink className="w-3 h-3" />
              </a>
            : 'repohq.vercel.app/u/[your-github-username]'
          }
        </p>
      </div>
      <Switch
        checked={isPublic}
        onCheckedChange={handleToggle}
        disabled={loading}
        aria-label="Toggle public portfolio"
      />
    </div>
  )
}
