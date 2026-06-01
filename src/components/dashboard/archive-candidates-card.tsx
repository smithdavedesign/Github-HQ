'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Archive, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { updateLifecycleStatus } from '@/lib/actions/repositories'
import { toast } from 'sonner'

interface ArchiveCandidate {
  id: number
  name: string
  description: string | null
  archiveScore: number
  lifecycleStatus: string | null
}

interface ArchiveCandidatesCardProps {
  candidates: ArchiveCandidate[]
}

function scoreBadge(score: number) {
  if (score >= 80) return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400'
  if (score >= 70) return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400'
  return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400'
}

export function ArchiveCandidatesCard({ candidates: initial }: ArchiveCandidatesCardProps) {
  const [candidates, setCandidates] = useState(initial)
  const [archiving, setArchiving] = useState<number | null>(null)

  if (candidates.length === 0) return null

  async function handleArchive(id: number, name: string) {
    setArchiving(id)
    try {
      await updateLifecycleStatus(id, 'sunsetting')
      setCandidates(prev => prev.filter(c => c.id !== id))
      toast.success(`${name} moved to Sunsetting`)
    } catch {
      toast.error('Failed to update lifecycle')
    } finally {
      setArchiving(null)
    }
  }

  return (
    <Card className="card-elevated border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/50 flex items-center justify-center">
            <Archive className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Archive Candidates</CardTitle>
            <p className="text-xs text-muted-foreground">Inactive repos with low signal</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.slice(0, 5).map(c => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border/60 bg-muted/30"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  href={`/repos/${c.id}`}
                  className="text-sm font-medium truncate hover:underline"
                >
                  {c.name}
                </Link>
                <Badge variant="outline" className={`text-xs shrink-0 ${scoreBadge(c.archiveScore)}`}>
                  {c.archiveScore}
                </Badge>
              </div>
              {c.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                onClick={() => handleArchive(c.id, c.name)}
                disabled={archiving === c.id}
              >
                Sunset
              </Button>
              <Link href={`/repos/${c.id}`}>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        ))}
        {candidates.length > 5 && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            +{candidates.length - 5} more — <Link href="/repos" className="underline">view all</Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
