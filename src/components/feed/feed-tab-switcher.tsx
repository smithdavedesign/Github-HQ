'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Activity, Trophy } from 'lucide-react'

interface Props {
  activeTab: 'feed' | 'milestones'
}

export function FeedTabSwitcher({ activeTab }: Props) {
  return (
    <div className="flex gap-1 border-b border-border/60">
      <Link
        href="/feed"
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
          activeTab === 'feed'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )}
      >
        <Activity className="w-3.5 h-3.5" />
        Feed
      </Link>
      <Link
        href="/feed?tab=milestones"
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
          activeTab === 'milestones'
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )}
      >
        <Trophy className="w-3.5 h-3.5" />
        Milestones
      </Link>
    </div>
  )
}
