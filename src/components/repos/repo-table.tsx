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
import { useState, useMemo } from 'react'
import { HealthBadge, ActivityBadge } from './health-badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { ArrowUpDown, ChevronDown, Download, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/utils'
import type { Repository, RepositoryMetrics, TechStack, Deployment } from '@/lib/db/schema'

type RepoRow = Repository & {
  metrics: RepositoryMetrics | null
  techStack: TechStack | null
  deployments: Deployment[]
  securityFindings: { severity: string }[]
}

interface RepoTableProps {
  data: RepoRow[]
}

export function RepoTable({ data }: RepoTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'healthScore', desc: true },
  ])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    forks: false,
    isFork: false,
  })
  const [globalFilter, setGlobalFilter] = useState('')

  const columns = useMemo<ColumnDef<RepoRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Repository',
        enablePinning: true,
        cell: ({ row }) => (
          <div>
            <Link
              href={`/repos/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.description && (
              <p className="text-xs text-muted-foreground truncate max-w-48 mt-0.5">
                {row.original.description}
              </p>
            )}
          </div>
        ),
      },
      {
        id: 'visibility',
        accessorKey: 'visibility',
        header: 'Visibility',
        cell: ({ getValue }) => (
          <Badge variant="outline" className="text-xs capitalize">
            {getValue<string>()}
          </Badge>
        ),
      },
      {
        id: 'healthScore',
        accessorFn: (row) => row.metrics?.healthScore ?? -1,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 gap-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Health
            <ArrowUpDown className="w-3 h-3" />
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
        cell: ({ getValue }) => {
          const score = getValue<number>()
          return <HealthBadge score={score} showScore />
        },
      },
      {
        id: 'lastPush',
        accessorFn: (row) => row.metrics?.lastPush,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 gap-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Last Push
            <ArrowUpDown className="w-3 h-3" />
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
        header: 'Production URL',
        cell: ({ row }) => {
          const dep = row.original.deployments[0]
          if (!dep) return <span className="text-xs text-muted-foreground">—</span>
          const statusColor = dep.status === 'healthy' ? 'text-emerald-500'
            : dep.status === 'slow' ? 'text-amber-500'
            : 'text-red-500'
          return (
            <a
              href={dep.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 text-xs hover:underline ${statusColor}`}
            >
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
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums">{getValue<number>()}</span>
        ),
      },
      {
        id: 'openPrs',
        accessorFn: (row) => row.metrics?.openPrs ?? 0,
        header: 'PRs',
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums">{getValue<number>()}</span>
        ),
      },
      {
        id: 'framework',
        accessorFn: (row) => row.techStack?.frontend ?? row.techStack?.language ?? '—',
        header: 'Framework',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        id: 'database',
        accessorFn: (row) => row.techStack?.database ?? '—',
        header: 'Database',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        id: 'hosting',
        accessorFn: (row) => row.techStack?.hosting ?? '—',
        header: 'Hosting',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        id: 'aiDetected',
        accessorFn: (row) => row.techStack?.aiTools,
        header: 'AI',
        cell: ({ getValue }) => {
          const tools = getValue<string | null>()
          return tools
            ? <Badge variant="outline" className="text-xs">{tools}</Badge>
            : <span className="text-xs text-muted-foreground">—</span>
        },
      },
    ],
    [],
  )

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

        <Button variant="outline" size="sm" className="h-8 gap-1 ml-auto" onClick={exportCsv}>
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center py-12 text-muted-foreground text-sm"
                >
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
        <span>
          {table.getFilteredRowModel().rows.length} of {data.length} repositories
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
