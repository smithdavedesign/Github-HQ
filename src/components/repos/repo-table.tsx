'use client'

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useState, useMemo, useCallback } from 'react'
import { HealthBadge, ActivityBadge } from './health-badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { ArrowUpDown, ChevronDown, Download, ExternalLink, CheckCircle, XCircle, DollarSign, Bookmark, Trash2, Star, GitPullRequest } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow, toNum } from '@/lib/utils'
import { toggleRevenueGenerating } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import type { Repository, RepositoryMetrics, TechStack, Deployment } from '@/lib/db/schema'
import type { NLQueryFilters } from '@/app/api/nl-query/route'
import { LifecycleBadge } from './lifecycle-badge'
import { LIFECYCLE_META, type LifecycleStage } from '@/lib/lifecycle'
import { formatValuation, type ValuationConfidence } from '@/lib/health/valuation'

type RepoRow = Repository & {
  metrics: RepositoryMetrics | null
  techStack: TechStack | null
  deployments: Deployment[]
  securityFindings: { severity: string }[]
}

const SAVED_VIEWS_KEY = 'repohq:saved-views'
const ACTIVE_VIEW_KEY = 'repohq:active-view'

interface SavedView {
  name: string
  columnVisibility: VisibilityState
  sorting: SortingState
}

function loadSavedViews(): Record<string, SavedView> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * Apply NL query filters to the raw repo rows before passing to TanStack.
 * Structured filters from Claude are applied as pure JS predicates — no SQL.
 */
function applyNLFilters(rows: RepoRow[], filters: NLQueryFilters): RepoRow[] {
  const now = Date.now()
  let result = rows.filter(row => {
    const m = row.metrics
    const stack = row.techStack

    if (filters.healthMin != null && (m?.healthScore ?? 0) < filters.healthMin) return false
    if (filters.healthMax != null && (m?.healthScore ?? 0) > filters.healthMax) return false

    if (filters.activityStatus && filters.activityStatus.length > 0) {
      if (!m?.activityStatus || !filters.activityStatus.includes(m.activityStatus)) return false
    }

    if (filters.lastPushBeforeDays != null) {
      const cutoff = now - filters.lastPushBeforeDays * 86400_000
      const push = m?.lastPush ? new Date(m.lastPush).getTime() : 0
      if (push > cutoff) return false
    }

    if (filters.lastPushAfterDays != null) {
      const cutoff = now - filters.lastPushAfterDays * 86400_000
      const push = m?.lastPush ? new Date(m.lastPush).getTime() : 0
      if (push < cutoff) return false
    }

    if (filters.visibility && row.visibility !== filters.visibility) return false

    if (filters.language) {
      const lang = (stack?.language ?? row.language ?? '').toLowerCase()
      if (!lang.includes(filters.language.toLowerCase())) return false
    }

    if (filters.framework) {
      const fw = (stack?.frontend ?? '').toLowerCase()
      if (!fw.includes(filters.framework.toLowerCase())) return false
    }

    if (filters.database) {
      const db_ = (stack?.database ?? '').toLowerCase()
      if (!db_.includes(filters.database.toLowerCase())) return false
    }

    if (filters.isRevenueGenerating != null && row.isRevenueGenerating !== filters.isRevenueGenerating) return false

    if (filters.hasSecurityIssues === true) {
      const serious = row.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high')
      if (serious.length === 0) return false
    }

    if (filters.starsMin != null && (row.stars ?? 0) < filters.starsMin) return false

    if (filters.mrrMin != null && toNum(row.mrr) < filters.mrrMin) return false

    return true
  })

  // Apply NL sort if specified
  if (filters.sortBy) {
    // dir=1 → (b-a) → descending  |  dir=-1 → (a-b) → ascending
    const dir = filters.sortDir === 'desc' ? 1 : -1
    result = result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'health': return ((b.metrics?.healthScore ?? 0) - (a.metrics?.healthScore ?? 0)) * dir
        case 'activity': return ((b.metrics?.activityScore ?? 0) - (a.metrics?.activityScore ?? 0)) * dir
        case 'security': return ((b.metrics?.securityScore ?? 0) - (a.metrics?.securityScore ?? 0)) * dir
        case 'lastPush': {
          const aT = a.metrics?.lastPush ? new Date(a.metrics.lastPush).getTime() : 0
          const bT = b.metrics?.lastPush ? new Date(b.metrics.lastPush).getTime() : 0
          return (bT - aT) * dir
        }
        case 'stars': return ((b.stars ?? 0) - (a.stars ?? 0)) * dir
        case 'mrr': return (toNum(b.mrr) - toNum(a.mrr)) * dir
        case 'name': return a.name.localeCompare(b.name) * dir
        default: return 0
      }
    })
  }

  return result
}

export function RepoTable({ data, nlFilters, nlExplanation, openAgentPRs }: {
  data: RepoRow[]
  nlFilters?: NLQueryFilters | null
  nlExplanation?: string | null
  openAgentPRs?: Record<number, { prUrl: string; taskId: string }>
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'healthScore', desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    tags: false, buildStatus: false, mrr: false, techDebt: false, valuation: false,
    purpose: false, focus: false, archiveScore: false,
  })
  const [globalFilter, setGlobalFilter] = useState('')
  const [savedViews, setSavedViews] = useState<Record<string, SavedView>>(loadSavedViews)
  const [viewNameInput, setViewNameInput] = useState('')
  const [revenueLoading, setRevenueLoading] = useState<number | null>(null)

  const handleRevenueToggle = useCallback(async (repoId: number, current: boolean) => {
    setRevenueLoading(repoId)
    try {
      await toggleRevenueGenerating(repoId, !current)
      toast.success(!current ? 'Marked as revenue-generating' : 'Removed revenue flag')
    } catch {
      toast.error('Failed to update')
    } finally {
      setRevenueLoading(null)
    }
  }, [])

  const columns = useMemo<ColumnDef<RepoRow>[]>(() => [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Repository',
      cell: ({ row }) => {
        const openPR = openAgentPRs?.[row.original.id]
        return (
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={`/repos/${row.original.id}`} className="font-medium hover:underline">
                {row.original.name}
              </Link>
              <a
                href={`https://github.com/${row.original.fullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Open on GitHub"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
              {openPR?.prUrl && (
                <a
                  href={openPR.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-200 hover:bg-blue-500/20 transition-colors"
                  title="Agent PR open — click to review"
                >
                  <GitPullRequest className="w-2.5 h-2.5" />
                  PR open
                </a>
              )}
            </div>
            {row.original.description && (
              <p className="text-xs text-muted-foreground truncate max-w-48 mt-0.5">{row.original.description}</p>
            )}
          </div>
        )
      },
    },
    {
      id: 'visibility',
      accessorKey: 'visibility',
      header: 'Visibility',
      cell: ({ getValue }) => (
        <Badge variant="outline" className="text-xs capitalize">{getValue<string>()}</Badge>
      ),
    },
    {
      id: 'opportunityScore',
      accessorFn: (row) => row.metrics?.opportunityScore ?? -1,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Opp <ArrowUpDown className="w-3 h-3" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const score = getValue<number>()
        if (score < 0) return <span className="text-muted-foreground text-xs">—</span>
        const rounded = Math.round(score)
        const color = rounded >= 55 ? 'text-violet-600' : rounded >= 30 ? 'text-blue-600' : 'text-muted-foreground'
        return <span className={`text-xs font-mono tabular-nums ${color}`}>{rounded}</span>
      },
      sortDescFirst: true,
    },
    {
      id: 'healthScore',
      accessorFn: (row) => row.metrics?.healthScore ?? -1,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Health <ArrowUpDown className="w-3 h-3" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const score = getValue<number>()
        return score >= 0 ? <HealthBadge score={score} /> : <span className="text-muted-foreground text-xs">—</span>
      },
      sortDescFirst: true,
    },
    {
      id: 'activityScore',
      accessorFn: (row) => row.metrics?.activityScore ?? -1,
      header: 'Activity',
      cell: ({ row }) => {
        const status = row.original.metrics?.activityStatus
        return status ? <ActivityBadge status={status} /> : <span className="text-muted-foreground text-xs">—</span>
      },
    },
    {
      id: 'securityScore',
      accessorFn: (row) => row.metrics?.securityScore ?? 100,
      header: 'Security',
      cell: ({ getValue }) => <HealthBadge score={getValue<number>()} showScore />,
    },
    {
      id: 'buildStatus',
      accessorFn: (row) => row.metrics?.buildStatus,
      header: 'Build',
      cell: ({ getValue }) => {
        const status = getValue<string | null>()
        if (!status) return <span className="text-muted-foreground text-xs">—</span>
        return status === 'success'
          ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle className="w-3 h-3" />Pass</span>
          : status === 'failure'
            ? <span className="flex items-center gap-1 text-xs text-red-600"><XCircle className="w-3 h-3" />Fail</span>
            : <span className="text-xs text-muted-foreground capitalize">{status}</span>
      },
    },
    {
      id: 'lastPush',
      accessorFn: (row) => row.metrics?.lastPush,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Last Push <ArrowUpDown className="w-3 h-3" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const date = getValue<Date | null>()
        return date
          ? <span className="text-xs text-muted-foreground">{formatDistanceToNow(date)}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      id: 'productionUrl',
      accessorFn: (row) => row.deployments[0]?.url,
      header: 'Production',
      cell: ({ row }) => {
        const dep = row.original.deployments[0]
        if (!dep) return <span className="text-xs text-muted-foreground">—</span>
        const statusColor = dep.status === 'healthy' ? 'text-emerald-500' : dep.status === 'slow' ? 'text-amber-500' : 'text-red-500'
        return (
          <a href={dep.url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1 text-xs hover:underline ${statusColor}`}>
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-32">{dep.url.replace(/^https?:\/\//, '')}</span>
          </a>
        )
      },
    },
    {
      id: 'openIssues',
      accessorFn: (row) => row.metrics?.openIssues ?? 0,
      header: 'Issues',
      cell: ({ getValue }) => <span className="text-xs tabular-nums">{getValue<number>()}</span>,
    },
    {
      id: 'openPrs',
      accessorFn: (row) => row.metrics?.openPrs ?? 0,
      header: 'PRs',
      cell: ({ getValue }) => <span className="text-xs tabular-nums">{getValue<number>()}</span>,
    },
    {
      id: 'framework',
      accessorFn: (row) => row.techStack?.frontend ?? row.techStack?.language ?? '—',
      header: 'Framework',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
    },
    {
      id: 'database',
      accessorFn: (row) => row.techStack?.database ?? '—',
      header: 'Database',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
    },
    {
      id: 'hosting',
      accessorFn: (row) => row.techStack?.hosting ?? '—',
      header: 'Hosting',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span>,
    },
    {
      id: 'aiDetected',
      accessorFn: (row) => row.techStack?.aiTools,
      header: 'AI',
      cell: ({ getValue }) => {
        const tools = getValue<string | null>()
        return tools ? <Badge variant="outline" className="text-xs">{tools}</Badge> : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      id: 'mrr',
      accessorFn: (row) => toNum(row.mrr),
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          MRR <ArrowUpDown className="w-3 h-3" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const v = getValue<number>()
        return v > 0
          ? <span className="text-xs text-emerald-600 font-medium">${v.toFixed(0)}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
      sortDescFirst: true,
    },
    {
      id: 'revenue',
      accessorFn: (row) => row.isRevenueGenerating,
      header: 'Revenue',
      cell: ({ row }) => {
        const isRev = row.original.isRevenueGenerating
        const id = row.original.id
        return (
          <button
            onClick={() => handleRevenueToggle(id, isRev ?? false)}
            disabled={revenueLoading === id}
            className={`flex items-center gap-1 text-xs transition-colors ${isRev ? 'text-emerald-600' : 'text-muted-foreground hover:text-foreground'}`}
            title={isRev ? 'Mark as non-revenue' : 'Mark as revenue-generating'}
          >
            <DollarSign className="w-3 h-3" />
            {isRev ? 'Yes' : 'No'}
          </button>
        )
      },
    },
    {
      id: 'valuation',
      accessorFn: (row) => row.metrics?.estimatedValue ?? 0,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Value <ArrowUpDown className="w-3 h-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const value = row.original.metrics?.estimatedValue ?? 0
        const confidence = (row.original.metrics?.valuationConfidence ?? 'none') as ValuationConfidence
        if (value === 0 || confidence === 'none') {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        const confidenceColor = confidence === 'medium' ? 'text-emerald-600' : 'text-muted-foreground'
        return (
          <span className={`text-xs font-mono font-medium tabular-nums ${confidenceColor}`}>
            {formatValuation(value)}
          </span>
        )
      },
      sortDescFirst: true,
    },
    {
      id: 'purpose',
      accessorKey: 'purpose',
      header: 'Purpose',
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        return v
          ? <Badge variant="secondary" className="text-xs">{v}</Badge>
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      id: 'focus',
      accessorKey: 'isFocused',
      header: 'Focus',
      cell: ({ getValue }) => (
        <Star className={`w-3.5 h-3.5 ${getValue<boolean>() ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
      ),
    },
    {
      id: 'archiveScore',
      accessorFn: (row) => row.metrics?.archiveScore ?? 0,
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Archive <ArrowUpDown className="w-3 h-3" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const score = Math.round(getValue<number>())
        if (score === 0) return <span className="text-xs text-muted-foreground">—</span>
        const color = score >= 70 ? 'text-red-600 bg-red-50 border-red-200'
          : score >= 45 ? 'text-amber-600 bg-amber-50 border-amber-200'
          : 'text-slate-500 bg-slate-50 border-slate-200'
        return <Badge variant="outline" className={`text-xs tabular-nums ${color}`}>{score}</Badge>
      },
      sortDescFirst: true,
    },
    {
      id: 'lifecycle',
      accessorFn: (row) => row.lifecycleStatus ?? 'maintaining',
      header: 'Lifecycle',
      cell: ({ getValue }) => <LifecycleBadge status={getValue<string>()} />,
    },
    {
      id: 'techDebt',
      accessorFn: (row) => {
        const analysis = row.claudeAnalysis as { techDebt?: { level?: string } } | null
        return analysis?.techDebt?.level ?? null
      },
      header: 'Tech Debt',
      cell: ({ getValue }) => {
        const level = getValue<string | null>()
        if (!level) return <span className="text-xs text-muted-foreground">—</span>
        const styles: Record<string, string> = {
          Low: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
          Medium: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
          High: 'text-red-600 bg-red-500/10 border-red-500/20',
        }
        return <Badge variant="outline" className={`text-xs ${styles[level] ?? ''}`}>{level}</Badge>
      },
      sortingFn: (a, b) => {
        const order: Record<string, number> = { High: 3, Medium: 2, Low: 1 }
        const aLevel = (a.original.claudeAnalysis as { techDebt?: { level?: string } } | null)?.techDebt?.level ?? ''
        const bLevel = (b.original.claudeAnalysis as { techDebt?: { level?: string } } | null)?.techDebt?.level ?? ''
        return (order[aLevel] ?? 0) - (order[bLevel] ?? 0)
      },
    },
    {
      id: 'tags',
      accessorFn: (row) => (row.tags ?? []).join(', '),
      header: 'Tags',
      cell: ({ row }) => {
        const tags = row.original.tags ?? []
        return tags.length > 0
          ? <div className="flex gap-1 flex-wrap">{tags.slice(0, 2).map(t => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}{tags.length > 2 && <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>}</div>
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
  ], [revenueLoading, handleRevenueToggle, openAgentPRs])

  // Apply NL filters first, then let TanStack handle the rest
  const filteredData = nlFilters ? applyNLFilters(data, nlFilters) : data

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  function saveView() {
    if (!viewNameInput.trim()) return
    const view: SavedView = { name: viewNameInput.trim(), columnVisibility, sorting }
    const updated = { ...savedViews, [view.name]: view }
    setSavedViews(updated)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(updated))
    setViewNameInput('')
    toast.success(`View "${view.name}" saved`)
  }

  function loadView(view: SavedView) {
    setColumnVisibility(view.columnVisibility)
    setSorting(view.sorting)
    localStorage.setItem(ACTIVE_VIEW_KEY, view.name)
    toast.success(`Loaded view "${view.name}"`)
  }

  function deleteView(name: string) {
    const updated = { ...savedViews }
    delete updated[name]
    setSavedViews(updated)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(updated))
  }

  function exportCsv() {
    const headers = table.getVisibleLeafColumns().map((c) => c.id).join(',')
    const rows = table.getFilteredRowModel().rows.map((row) =>
      row.getVisibleCells().map((cell) => {
        const val = cell.getValue()
        if (val instanceof Date) return val.toISOString()
        return String(val ?? '')
      }).join(',')
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'repohq-repos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search repositories…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="h-8 w-64 text-sm"
        />

        {/* Columns */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              Columns <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {table.getAllColumns().filter((col) => col.getCanHide()).map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                className="capitalize text-sm"
                checked={col.getIsVisible()}
                onCheckedChange={(value) => col.toggleVisibility(!!value)}
              >
                {col.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Saved views */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Bookmark className="w-3.5 h-3.5" /> Views <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {Object.keys(savedViews).length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet</div>
            )}
            {Object.values(savedViews).map((view) => (
              <div key={view.name} className="flex items-center">
                <DropdownMenuItem className="flex-1 text-sm" onSelect={() => loadView(view)}>
                  {view.name}
                </DropdownMenuItem>
                <button
                  className="px-2 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteView(view.name)}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <DropdownMenuSeparator />
            <div className="flex gap-1 px-2 py-1.5">
              <Input
                placeholder="View name…"
                value={viewNameInput}
                onChange={(e) => setViewNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveView()}
                className="h-6 text-xs flex-1"
              />
              <Button size="sm" className="h-6 text-xs px-2" onClick={saveView}>Save</Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" className="h-8 gap-1 ml-auto" onClick={exportCsv}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-muted-foreground text-sm">
                  No repositories found. Click <strong>Sync</strong> to import from GitHub.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t hover:bg-muted/30 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
        <span>
          {table.getFilteredRowModel().rows.length} of {data.length} repositories
          {nlFilters && filteredData.length !== data.length && ` (${filteredData.length} after AI filter)`}
        </span>
        <div className="flex items-center gap-3">
          {/* Rows per page */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs">Rows</span>
            <select
              value={table.getState().pagination.pageSize}
              onChange={e => table.setPageSize(Number(e.target.value))}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {[10, 25, 50, 100].map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          {/* Page info */}
          <span className="text-xs">
            {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}
          </span>
          {/* Prev / Next */}
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>←</Button>
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>→</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
