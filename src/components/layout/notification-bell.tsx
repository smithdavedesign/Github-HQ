'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Bot, Shield, TrendingDown, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDistanceToNow } from '@/lib/utils'
import { markAllNotificationsRead, markNotificationRead } from '@/lib/actions/notifications'
import Link from 'next/link'
import type { Notification } from '@/lib/db/schema'

type NotificationWithRepo = Notification & { repository?: { name: string; id: number } | null }

const EVENT_ICONS: Record<string, typeof Bell> = {
  health_alert:      TrendingDown,
  agent_pr_ready:    Bot,
  agent_pr_merged:   Bot,
  agent_failed:      Bot,
  security_critical: Shield,
}

const EVENT_COLORS: Record<string, string> = {
  health_alert:      'text-amber-500',
  agent_pr_ready:    'text-blue-500',
  agent_pr_merged:   'text-emerald-500',
  agent_failed:      'text-red-400',
  security_critical: 'text-red-500',
}

export function NotificationBell() {
  const [count, setCount]   = useState(0)
  const [items, setItems]   = useState<NotificationWithRepo[]>([])
  const [open, setOpen]     = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?countOnly=true')
      if (!res.ok) return
      const data = await res.json() as { count: number }
      setCount(data.count)
    } catch {}
  }, [])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json() as { items: NotificationWithRepo[]; count: number }
      setItems(data.items)
      setCount(data.count)
    } catch {} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCount()
    const interval = setInterval(fetchCount, 120_000)
    return () => clearInterval(interval)
  }, [fetchCount])

  async function handleOpen(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) await fetchItems()
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    setItems([])
    setCount(0)
  }

  async function handleMarkRead(id: number) {
    await markNotificationRead(id)
    setItems(prev => prev.filter(n => n.id !== id))
    setCount(prev => Math.max(0, prev - 1))
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 relative text-muted-foreground hover:text-foreground"
        aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
        onClick={() => handleOpen(true)}
      >
        <Bell className="w-3.5 h-3.5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetContent side="right" className="w-80 p-0 flex flex-col">
          <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b border-border/60 space-y-0">
            <SheetTitle className="text-sm font-semibold">Notifications</SheetTitle>
            {items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleMarkAllRead}
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </Button>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="w-6 h-6 mx-auto mb-2 opacity-20" />
                <p className="text-xs text-muted-foreground">All caught up</p>
              </div>
            ) : (
              items.map(n => {
                const Icon = EVENT_ICONS[n.eventType] ?? Bell
                const color = EVENT_COLORS[n.eventType] ?? 'text-muted-foreground'
                const meta = n.metadata as Record<string, unknown> | null
                const prUrl = meta?.prUrl as string | undefined
                const repoHref = n.repository ? `/repos/${n.repository.id}` : null

                return (
                  <div key={n.id} className="flex gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                    <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-snug">{n.title}</p>
                      {n.body && <p className="text-[11px] text-muted-foreground mt-0.5">{n.body}</p>}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(n.createdAt)}</span>
                        {repoHref && (
                          <Link href={repoHref} className="text-[10px] text-blue-500 hover:underline" onClick={() => handleMarkRead(n.id)}>
                            View repo
                          </Link>
                        )}
                        {prUrl && (
                          <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline inline-flex items-center gap-0.5">
                            PR <ExternalLink className="w-2 h-2" />
                          </a>
                        )}
                      </div>
                    </div>
                    <button
                      className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                      onClick={() => handleMarkRead(n.id)}
                      title="Mark as read"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-border/60 text-center">
            <Link href="/agent-performance" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
              View all agent activity →
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
