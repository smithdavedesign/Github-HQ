'use client'

import { useState, useTransition, useMemo } from 'react'
import { createMilestone, deleteEvent } from '@/lib/actions/changelog'
import type { PortfolioEvent as BasePortfolioEvent } from '@/lib/db/schema'

type PortfolioEvent = BasePortfolioEvent & { repoName?: string | null }
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDistanceToNow } from '@/lib/utils'
import { toast } from 'sonner'
import {
  PlusCircle, Trash2, Rocket, TrendingUp, DollarSign,
  Trophy, Heart, Star, Flag,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const EVENT_ICONS: Record<string, typeof Rocket> = {
  repo_created:      Rocket,
  repo_archived:     Flag,
  mrr_changed:       DollarSign,
  health_milestone:  Heart,
  first_revenue:     Trophy,
  manual_milestone:  Star,
}

const EVENT_COLORS: Record<string, string> = {
  repo_created:      'bg-indigo-100 text-indigo-700 border-indigo-200',
  repo_archived:     'bg-slate-100 text-slate-600 border-slate-200',
  mrr_changed:       'bg-emerald-100 text-emerald-700 border-emerald-200',
  health_milestone:  'bg-blue-100 text-blue-700 border-blue-200',
  first_revenue:     'bg-amber-100 text-amber-700 border-amber-200',
  manual_milestone:  'bg-purple-100 text-purple-700 border-purple-200',
}

const EVENT_LABELS: Record<string, string> = {
  repo_created:      'New Repo',
  repo_archived:     'Archived',
  mrr_changed:       'Revenue',
  health_milestone:  'Health',
  first_revenue:     'First Revenue',
  manual_milestone:  'Milestone',
}

interface Props {
  events: (PortfolioEvent & { repoName?: string | null })[]
  exportYear: number
}

export function MilestonesTab({ events, exportYear }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [selectedYear, setSelectedYear] = useState<number | null>(null)

  const years = useMemo(() => {
    const seen = new Set<number>()
    for (const e of events) seen.add(new Date(e.occurredAt).getFullYear())
    return Array.from(seen).sort((a, b) => b - a)
  }, [events])

  const filteredEvents = useMemo(() =>
    selectedYear ? events.filter(e => new Date(e.occurredAt).getFullYear() === selectedYear) : events,
  [events, selectedYear])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setAdding(true)
    try {
      await createMilestone(title, desc)
      setTitle('')
      setDesc('')
      setShowForm(false)
      toast.success('Milestone added')
      router.refresh()
    } catch {
      toast.error('Failed to add milestone')
    } finally {
      setAdding(false)
    }
  }

  function handleDelete(id: number) {
    startTransition(async () => {
      try {
        await deleteEvent(id)
        toast.success('Milestone removed')
        router.refresh()
      } catch {
        toast.error('Failed to remove')
      }
    })
  }

  const grouped = groupByMonth(filteredEvents)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
          </p>
          {years.length > 1 && (
            <div className="flex gap-1">
              <button
                onClick={() => setSelectedYear(null)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${!selectedYear ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                All
              </button>
              {years.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${selectedYear === y ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/changelog/export?year=${selectedYear ?? exportYear}`}
            download
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Export {selectedYear ?? exportYear} →
          </a>
          <Button size="sm" variant="outline" onClick={() => setShowForm(v => !v)}>
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
            Add milestone
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-4">
            <form onSubmit={handleAdd} className="space-y-2">
              <Input
                placeholder="What did you ship or achieve?"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="text-sm"
                autoFocus
              />
              <Input
                placeholder="Optional details…"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={!title.trim() || adding}>
                  {adding ? 'Adding…' : 'Save milestone'}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {filteredEvents.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          <TrendingUp className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No events yet</p>
          <p className="text-xs mt-1">Sync your repos to capture portfolio events automatically</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([month, monthEvents]) => (
            <div key={month}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{month}</p>
              <div className="space-y-2 border-l border-border/60 ml-2 pl-4">
                {monthEvents.map(event => {
                  const Icon = EVENT_ICONS[event.eventType] ?? Star
                  const colorClass = EVENT_COLORS[event.eventType] ?? 'bg-slate-100 text-slate-600 border-slate-200'
                  const label = EVENT_LABELS[event.eventType] ?? event.eventType

                  return (
                    <div key={event.id} className="flex items-start gap-3 relative">
                      <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-background border-2 border-border" />
                      <Icon className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colorClass}`}>
                                {label}
                              </Badge>
                              {event.repoName && (
                                <Link href={`/repos/${event.repoId}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                                  {event.repoName}
                                </Link>
                              )}
                            </div>
                            <p className="text-sm font-medium mt-0.5">{event.title}</p>
                            {event.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(event.occurredAt)}
                            </span>
                            {event.eventType === 'manual_milestone' && (
                              <button
                                onClick={() => handleDelete(event.id)}
                                disabled={isPending}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                aria-label="Remove milestone"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function groupByMonth(events: (BasePortfolioEvent & { repoName?: string | null })[]): Record<string, PortfolioEvent[]> {
  const groups: Record<string, PortfolioEvent[]> = {}
  for (const event of events) {
    const key = new Date(event.occurredAt).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    if (!groups[key]) groups[key] = []
    groups[key].push(event)
  }
  return groups
}
