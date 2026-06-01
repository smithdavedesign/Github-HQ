'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EFFORT_META, type EffortLevel } from '@/lib/effort'
import { updateRepoEffort } from '@/lib/actions/repositories'
import { toast } from 'sonner'

export function EffortSelector({ repoId, current }: { repoId: number; current: string | null | undefined }) {
  const [value, setValue] = useState<EffortLevel>((current as EffortLevel) ?? 'medium')

  async function handleChange(next: string) {
    const effort = next as EffortLevel
    setValue(effort)
    try {
      await updateRepoEffort(repoId, effort)
      toast.success(`Effort set to ${EFFORT_META[effort].label}`)
    } catch {
      toast.error('Failed to update effort')
    }
  }

  const meta = EFFORT_META[value]

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(EFFORT_META) as EffortLevel[]).map(level => (
            <SelectItem key={level} value={level} className="text-xs">
              <span className={EFFORT_META[level].color}>{EFFORT_META[level].label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{meta.description}</p>
    </div>
  )
}
