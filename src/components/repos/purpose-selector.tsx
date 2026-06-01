'use client'

import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateRepoPurpose } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import type { RepoPurpose } from '@/lib/db/schema'

export const PURPOSES: RepoPurpose[] = [
  'Revenue',
  'Learning',
  'Consulting',
  'Experiment',
  'Open Source',
  'Client Work',
  'Portfolio',
  'Infrastructure',
]

const PURPOSE_META: Record<RepoPurpose, { description: string; color: string }> = {
  Revenue:        { description: 'Generates or targets MRR/ARR',      color: 'text-emerald-600' },
  Learning:       { description: 'Built to learn a technology',        color: 'text-blue-600' },
  Consulting:     { description: 'Client or contract work',            color: 'text-purple-600' },
  Experiment:     { description: 'Proof of concept or spike',          color: 'text-amber-600' },
  'Open Source':  { description: 'Community-facing, no direct income', color: 'text-cyan-600' },
  'Client Work':  { description: 'Delivered to a specific client',     color: 'text-indigo-600' },
  Portfolio:      { description: 'Showcase / demo project',            color: 'text-pink-600' },
  Infrastructure: { description: 'Internal tooling or shared service', color: 'text-slate-600' },
}

interface PurposeSelectorProps {
  repoId: number
  current: string | null | undefined
}

export function PurposeSelector({ repoId, current }: PurposeSelectorProps) {
  const [value, setValue] = useState<RepoPurpose | 'none'>(
    (current as RepoPurpose) ?? 'none',
  )

  async function handleChange(next: string) {
    const newValue = next === 'none' ? null : next
    setValue(next as RepoPurpose | 'none')
    try {
      await updateRepoPurpose(repoId, newValue)
      toast.success(newValue ? `Purpose set to ${newValue}` : 'Purpose cleared')
    } catch {
      toast.error('Failed to update purpose')
    }
  }

  const meta = value !== 'none' ? PURPOSE_META[value as RepoPurpose] : null

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue placeholder="Set purpose…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" className="text-xs text-muted-foreground">
            — No purpose set —
          </SelectItem>
          {PURPOSES.map(p => (
            <SelectItem key={p} value={p} className="text-xs">
              <span className={PURPOSE_META[p].color}>{p}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {meta && (
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      )}
    </div>
  )
}
