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

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      await triggerSync()
      toast.success('Sync started')
      await queryClient.invalidateQueries({ queryKey: ['sync-status'] })
      let ticks = 0
      pollRef.current = setInterval(() => {
        router.refresh()
        queryClient.invalidateQueries({ queryKey: ['sync-status'] })
        ticks++
        if (ticks >= 36) { clearInterval(pollRef.current!); setSyncing(false) }
      }, 5000)
    } catch {
      toast.error('Failed to start sync')
      setSyncing(false)
    }
  }

  const initials = user.name?.split(' ').map((n) => n[0]).join('').toUpperCase() ?? '?'

  return (
    <header className="h-13 border-b border-border/60 flex items-center justify-between px-5 gap-4 bg-background/95 backdrop-blur-sm shrink-0">
      {/* Left — sync status */}
      <div className="flex items-center gap-3 min-w-0">
        {lastSyncedAt ? (
          <span className="text-xs text-muted-foreground hidden sm:block">
            Synced {formatRelative(lastSyncedAt)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground hidden sm:block">Never synced</span>
        )}
        <SyncProgress />
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="h-8 px-3 gap-1.5 text-xs font-medium border-border/60 shadow-none hover:bg-muted/60"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync'}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
          className="w-8 h-8 text-muted-foreground hover:text-foreground"
        >
          <Sun className="w-3.5 h-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute w-3.5 h-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full w-8 h-8 p-0">
              <Avatar className="w-7 h-7 ring-1 ring-border">
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? 'User'} />
                <AvatarFallback className="text-[10px] font-semibold bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-3 py-2">
              <p className="text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive gap-2 text-sm"
              onSelect={() => signOut({ callbackUrl: '/login' })}
            >
              <LogOut className="w-3.5 h-3.5" />
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
