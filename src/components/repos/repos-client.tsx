'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ListChecks, Skull } from 'lucide-react'
import { RepoTable } from './repo-table'
import { NLQueryBar } from './nl-query-bar'
import type { NLQueryFilters } from '@/app/api/nl-query/route'

interface ReposClientProps {
  repos: Parameters<typeof RepoTable>[0]['data']
  openAgentPRs?: Record<number, { prUrl: string; taskId: string }>
}

export function ReposClient({ repos, openAgentPRs }: ReposClientProps) {
  const [nlFilters, setNlFilters] = useState<NLQueryFilters | null>(null)
  const [nlExplanation, setNlExplanation] = useState<string | null>(null)
  const archivedCount = repos.filter(r => r.isArchived).length

  function handleFilters(filters: NLQueryFilters | null, explanation: string | null) {
    setNlFilters(filters)
    setNlExplanation(explanation)
  }

  return (
    <div className="space-y-3 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
          <p className="text-muted-foreground text-sm mt-1">
            All {repos.length} repositories — sortable, filterable, exportable
          </p>
        </div>
        {/* Moved here from the sidebar (2026-10-08): views of this list, not destinations of their own. */}
        <div className="flex items-center gap-2">
          <Link href="/repos/triage" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium hover:bg-muted">
            <ListChecks className="w-3.5 h-3.5" />Triage
          </Link>
          <Link href="/repos/graveyard" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <Skull className="w-3.5 h-3.5" />Graveyard{archivedCount ? ` (${archivedCount})` : ''}
          </Link>
        </div>
      </div>
      <NLQueryBar onFilters={handleFilters} />
      <RepoTable data={repos} nlFilters={nlFilters} nlExplanation={nlExplanation} openAgentPRs={openAgentPRs} />
    </div>
  )
}
