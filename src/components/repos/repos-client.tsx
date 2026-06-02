'use client'

import { useState } from 'react'
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

  function handleFilters(filters: NLQueryFilters | null, explanation: string | null) {
    setNlFilters(filters)
    setNlExplanation(explanation)
  }

  return (
    <div className="space-y-3 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
        <p className="text-muted-foreground text-sm mt-1">
          All {repos.length} repositories — sortable, filterable, exportable
        </p>
      </div>
      <NLQueryBar onFilters={handleFilters} />
      <RepoTable data={repos} nlFilters={nlFilters} nlExplanation={nlExplanation} openAgentPRs={openAgentPRs} />
    </div>
  )
}
