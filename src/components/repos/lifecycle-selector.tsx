'use client'

import { useState } from 'react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { LIFECYCLE_STAGES, LIFECYCLE_META, type LifecycleStage } from '@/lib/lifecycle'
import { updateLifecycleStatus } from '@/lib/actions/repositories'
import { AbandonmentPrompt } from './abandonment-prompt'
import { toast } from 'sonner'

const GRAVEYARD_STAGES: LifecycleStage[] = ['sunsetting', 'archived']

interface LifecycleSelectorProps {
  repoId: number
  repoName?: string
  current: string | null | undefined
}

export function LifecycleSelector({ repoId, repoName = 'this repo', current }: LifecycleSelectorProps) {
  const [value, setValue] = useState<LifecycleStage>((current as LifecycleStage) ?? 'maintaining')
  const [showPrompt, setShowPrompt] = useState(false)
  const [pendingStage, setPendingStage] = useState<LifecycleStage | null>(null)

  async function handleChange(next: string) {
    const stage = next as LifecycleStage
    setValue(stage)

    try {
      await updateLifecycleStatus(repoId, stage)
      toast.success(`Lifecycle set to ${LIFECYCLE_META[stage].label}`)
    } catch {
      toast.error('Failed to update lifecycle status')
      return
    }

    // Trigger abandonment prompt when moving to graveyard stages
    if (GRAVEYARD_STAGES.includes(stage)) {
      setPendingStage(stage)
      setShowPrompt(true)
    }
  }

  const meta = LIFECYCLE_META[value]

  return (
    <>
      <div className="space-y-1">
        <Select value={value} onValueChange={handleChange}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIFECYCLE_STAGES.map(stage => (
              <SelectItem key={stage} value={stage} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${LIFECYCLE_META[stage].bg} border`} />
                  {LIFECYCLE_META[stage].label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>

      <AbandonmentPrompt
        repoId={repoId}
        repoName={repoName}
        open={showPrompt}
        onClose={() => { setShowPrompt(false); setPendingStage(null) }}
      />
    </>
  )
}
