'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { EFFORTS, IDEA_SORTS, TAG_GROUPS, activeFilters, filtersQuery, type IdeaFilters, type IdeaSort } from '@/lib/ideas/idea-filters'

const MIN_SCORES = [null, 5, 6, 7] as const
/** Topics past this many (most used first) wait behind "+N more". */
const TOPICS_SHOWN = 8

/**
 * Sort and filter the Ideas page. One toolbar (search, sort, the Filters button, the count); the active
 * filters as removable chips under it; every filter in a panel that opens from the button, one labelled
 * row each. The filters live in the URL, so a filtered view can be bookmarked or shared.
 */
export function IdeaFilterBar({ filters, counts, topics, shown, total }: {
  filters: IdeaFilters
  /** How many ideas carry each tag, across all ideas. */
  counts: Record<string, number>
  /** Tags outside the groups, most used first. */
  topics: { tag: string; count: number }[]
  shown: number
  total: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const panelId = useId()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [allTopics, setAllTopics] = useState(false)
  const [q, setQ] = useState(filters.q)
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (typing.current) clearTimeout(typing.current) }, [])

  const go = (next: Partial<IdeaFilters>) => {
    const href = `${pathname}${filtersQuery({ ...filters, ...next })}`
    startTransition(() => router.replace(href, { scroll: false }))
  }
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const search = (value: string) => {
    setQ(value)
    if (typing.current) clearTimeout(typing.current)
    typing.current = setTimeout(() => go({ q: value }), 300)
  }
  const clear = () => {
    if (typing.current) clearTimeout(typing.current)
    setQ('')
    go({ tags: [], effort: [], minScore: null, q: '', mine: false })
  }

  const active = activeFilters(filters)
  const tagChip = (tag: string, label: string, count: number) => (
    <Chip key={tag} on={filters.tags.includes(tag)} count={count} onClick={() => go({ tags: toggle(filters.tags, tag) })}>{label}</Chip>
  )
  // A tag no idea carries is noise, unless it's picked (a shared link can name one).
  const present = (tag: string) => (counts[tag] ?? 0) > 0 || filters.tags.includes(tag)
  const topicsShown = allTopics ? topics : topics.filter((t, i) => i < TOPICS_SHOWN || filters.tags.includes(t.tag))

  return (
    <div className="rounded-xl border bg-card" data-testid="idea-filters">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={e => search(e.target.value)} placeholder="Search ideas" aria-label="Search ideas" className="h-8 w-full pl-8 pr-7" />
          {q && (
            <button type="button" onClick={() => search('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={filters.sort} onValueChange={v => go({ sort: v as IdeaSort })}>
          <SelectTrigger size="sm" aria-label="Sort ideas" className="h-8 gap-1 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IDEA_SORTS.map(s => (
              <SelectItem key={s.key} value={s.key} className="text-xs"
                title={s.key === 'credibility' ? 'How strong the review found the evidence that people want and pay for it' : undefined}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={panelId}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-muted', open && 'bg-muted')}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Filters
          {active.length > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground tabular-nums">{active.length}</span>}
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          <span data-testid="idea-filter-count" className="tabular-nums">{shown === total ? `${total} ideas` : `${shown} of ${total} ideas`}</span>
        </div>
      </div>

      {(active.length > 0 || filters.q.trim() !== '') && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2" role="group" aria-label="Active filters">
          {active.map(a => (
            <span key={a.key} className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2 pr-1 text-xs text-primary">
              {a.label}
              <button type="button" onClick={() => go(a.remove)} aria-label={`Remove ${a.label}`} className="rounded-full p-0.5 hover:bg-primary/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" onClick={clear} className="ml-1 text-xs font-medium text-primary hover:underline">Clear filters</button>
        </div>
      )}

      {open && (
        <div id={panelId} className="space-y-2.5 border-t p-3">
          <Row label="Score">
            {MIN_SCORES.map(m => (
              <Chip key={m ?? 'any'} on={filters.minScore === m} onClick={() => go({ minScore: m })}>{m === null ? 'Any' : `${m}+`}</Chip>
            ))}
          </Row>
          <Row label="Effort">
            {EFFORTS.map(e => (
              <Chip key={e} on={filters.effort.includes(e)} onClick={() => go({ effort: toggle(filters.effort, e) })}>{e[0]!.toUpperCase() + e.slice(1)}</Chip>
            ))}
          </Row>
          {TAG_GROUPS.map(g => {
            const tags = g.tags.filter(t => present(t.tag))
            return tags.length === 0 ? null : <Row key={g.key} label={g.label}>{tags.map(t => tagChip(t.tag, t.label, counts[t.tag] ?? 0))}</Row>
          })}
          {topics.length > 0 && (
            <Row label="Topics">
              {topicsShown.map(t => tagChip(t.tag, t.tag, t.count))}
              {topics.length > TOPICS_SHOWN && (
                <button type="button" onClick={() => setAllTopics(a => !a)} className="h-6 px-1 text-xs font-medium text-primary hover:underline">
                  {allTopics ? 'Fewer' : `+${topics.length - topicsShown.length} more`}
                </button>
              )}
            </Row>
          )}
          <Row label="Source">
            <Chip on={filters.mine} onClick={() => go({ mine: !filters.mine })} title="Ideas you sent: Slack, WhatsApp, the New idea box or a session">Sent by me</Chip>
          </Row>
        </div>
      )}
    </div>
  )
}

/** One filter: its label in a fixed column, so every row's chips start at the same place. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[7.5rem_1fr]" role="group" aria-label={label}>
      <span className="text-xs font-medium text-muted-foreground sm:pt-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ on, count, title, onClick, children }: { on: boolean; count?: number; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
        on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
      )}>
      {children}
      {count !== undefined && <span className={cn('tabular-nums', on ? 'opacity-80' : 'text-muted-foreground')}>{count}</span>}
    </button>
  )
}
