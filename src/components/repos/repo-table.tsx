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
import { ArrowUpDown, ChevronDown, Download, ExternalLink, CheckCircle, XCircle, DollarSign, Bookmark, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/utils'
import { toggleRevenueGenerating } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import type { Repository, RepositoryMetrics, TechStack, Deployment } from '@/lib/db/schema'

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

export function RepoTable({ data }: { data: RepoRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'healthScore', desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ tags: false, buildStatus: false, mrr: false })
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
      cell: ({ row }) => (
        <div>
          <Link href={`/repos/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
          {row.original.description && (
            <p className="text-xs text-muted-foreground truncate max-w-48 mt-0.5">{row.original.description}</p>
          )}
        </div>
      ),
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
      accessorFn: (row) => parseFloat(String(row.mrr ?? '0')),
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
  ], [revenueLoading, handleRevenueToggle])

  const table = useReactTable({
    data,
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
    initialState: { pagination: { pageSize: 50 } },
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
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{table.getFilteredRowModel().rows.length} of {data.length} repositories</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
          <Button variant="outline" size="sm" className="h-7" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
        </div>
      </div>
    </div>
  )
}
