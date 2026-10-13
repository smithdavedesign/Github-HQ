'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { EFFORTS, IDEA_SORTS, TAG_GROUPS, filtersActive, filtersQuery, type IdeaFilters } from '@/lib/ideas/idea-filters'

const MIN_SCORES = [null, 5, 6, 7] as const

/** Sort and filter the Ideas page. The filters live in the URL, so a filtered view can be bookmarked or shared. */
export function IdeaFilterBar({ filters, counts, topics, shown, total }: {
  filters: IdeaFilters
  /** How many ideas carry each tag, across all ideas. */
  counts: Record<string, number>
  topics: { tag: string; count: number }[]
  shown: number
  total: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
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

  return (
    <div className="rounded-xl border bg-card p-3 space-y-3" data-testid="idea-filters">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={e => search(e.target.value)} placeholder="Search ideas" aria-label="Search ideas" className="h-7 w-44 pl-7 pr-7" />
          {q && (
            <button type="button" onClick={() => search('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Row label="Sort">
          {IDEA_SORTS.map(s => (
            <Chip key={s.key} on={filters.sort === s.key} onClick={() => go({ sort: s.key })}
              title={s.key === 'credibility' ? 'How strong the review found the evidence that people want and pay for it' : undefined}>
              {s.label}
            </Chip>
          ))}
        </Row>
        <Row label="Score">
          {MIN_SCORES.map(m => (
            <Chip key={m ?? 'any'} on={filters.minScore === m} onClick={() => go({ minScore: m })}>{m === null ? 'Any' : `${m}+`}</Chip>
          ))}
        </Row>
        <Row label="Effort">
          {EFFORTS.map(e => (
            <Chip key={e} on={filters.effort.includes(e)} onClick={() => go({ effort: toggle(filters.effort, e) })}>{e[0].toUpperCase() + e.slice(1)}</Chip>
          ))}
        </Row>
        <Chip on={filters.mine} onClick={() => go({ mine: !filters.mine })} title="Ideas you sent: Slack, WhatsApp, the New idea box or a session">Sent by me</Chip>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          <span data-testid="idea-filter-count">Showing {shown} of {total}</span>
          {filtersActive(filters) && (
            <button type="button" onClick={clear} className="font-medium text-primary hover:underline">Clear filters</button>
          )}
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
        {TAG_GROUPS.map(g => (
          <Row key={g.key} label={g.label} wide>
            {g.tags.map(t => (
              <Chip key={t.tag} on={filters.tags.includes(t.tag)} count={counts[t.tag] ?? 0} onClick={() => go({ tags: toggle(filters.tags, t.tag) })}>{t.label}</Chip>
            ))}
          </Row>
        ))}
      </div>
      {topics.length > 0 && (
        <Row label="Topics" wide>
          {topics.map(t => (
            <Chip key={t.tag} on={filters.tags.includes(t.tag)} count={t.count} onClick={() => go({ tags: toggle(filters.tags, t.tag) })}>{t.tag}</Chip>
          ))}
        </Row>
      )}
    </div>
  )
}

function Row({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className={cn('text-xs text-muted-foreground', wide && 'w-28 shrink-0')}>{label}</span>
      {children}
    </div>
  )
}

function Chip({ on, count, title, onClick, children }: { on: boolean; count?: number; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
        on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
        !on && count === 0 && 'opacity-50',
      )}>
      {children}
      {count !== undefined && <span className={cn('tabular-nums', on ? 'opacity-80' : 'text-muted-foreground')}>{count}</span>}
    </button>
  )
}
