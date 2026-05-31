'use client'

import { signOut } from 'next-auth/react'
import { RefreshCw, LogOut, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/components/layout/theme-provider'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { triggerSync } from '@/lib/actions/sync'
import { SyncProgress } from './sync-progress'
import { toast } from 'sonner'

interface TopbarProps {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  lastSyncedAt?: Date | null
}

export function Topbar({ user, lastSyncedAt }: TopbarProps) {
  const { theme, setTheme } = useTheme()
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Stop polling when component unmounts
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      await triggerSync()
      toast.success('Sync started')

      // Immediately refresh the sync-status query so the progress bar appears
      await queryClient.invalidateQueries({ queryKey: ['sync-status'] })

      // Also refresh page data every 5s so repos appear live
      let ticks = 0
      pollRef.current = setInterval(() => {
        router.refresh()
        queryClient.invalidateQueries({ queryKey: ['sync-status'] })
        ticks++
        if (ticks >= 36) {
          clearInterval(pollRef.current!)
          setSyncing(false)
        }
      }, 5000)
    } catch {
      toast.error('Failed to start sync. Please try again.')
      setSyncing(false)
    }
  }

  const initials = user.name?.split(' ').map((n) => n[0]).join('').toUpperCase() ?? '?'

  return (
    <header className="h-14 border-b flex items-center justify-between px-4 gap-4 bg-background shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {lastSyncedAt ? `Last synced ${formatRelative(lastSyncedAt)}` : 'Never synced'}
        </span>
        <SyncProgress />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync'}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
          className="w-8 h-8"
        >
          <Sun className="w-4 h-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute w-4 h-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full w-8 h-8">
              <Avatar className="w-7 h-7">
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? 'User'} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive gap-2"
              onSelect={() => signOut({ callbackUrl: '/login' })}
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
