'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ShipItWarning } from '@/lib/actions/repositories'
import { Flame, X } from 'lucide-react'
import Link from 'next/link'

interface Props {
  warnings: ShipItWarning[]
}

const SNOOZE_DAYS = 3

function snoozeKey(repoId: number) {
  return `ship-it-snooze-${repoId}`
}

function isSnoozed(repoId: number): boolean {
  if (typeof window === 'undefined') return false
  const val = localStorage.getItem(snoozeKey(repoId))
  if (!val) return false
  return Date.now() < parseInt(val, 10)
}

function snooze(repoId: number) {
  localStorage.setItem(snoozeKey(repoId), String(Date.now() + SNOOZE_DAYS * 86400_000))
}

export function ShipItCard({ warnings }: Props) {
  const [visible, setVisible] = useState<ShipItWarning[]>([])

  useEffect(() => {
    setVisible(warnings.filter(w => !isSnoozed(w.repoId)))
  }, [warnings])

  function dismiss(repoId: number) {
    snooze(repoId)
    setVisible(v => v.filter(w => w.repoId !== repoId))
  }

  if (visible.length === 0) return null

  return (
    <div className="space-y-2">
      {visible.map(w => (
        <Card key={w.repoId} className="border-amber-500/30 bg-amber-500/[0.04] card-elevated">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Flame className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/repos/${w.repoId}`} className="text-sm font-semibold hover:underline">
                    {w.repoName}
                  </Link>
                  <span className="text-xs text-amber-600 font-medium">
                    ⭐ Focused · {w.daysSinceCommit} days without a commit
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Opportunity score: {w.opportunityScore} — this repo is worth your time.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                  <Link href={`/repos/${w.repoId}`}>Ship it →</Link>
                </Button>
                <button
                  onClick={() => dismiss(w.repoId)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Snooze ${w.repoName}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
