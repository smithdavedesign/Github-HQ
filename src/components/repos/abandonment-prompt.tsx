'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ABANDONMENT_REASONS, type AbandonmentReason } from '@/lib/graveyard'
import { updateAbandonmentReason } from '@/lib/actions/repositories'
import { toast } from 'sonner'

interface AbandonmentPromptProps {
  repoId: number
  repoName: string
  open: boolean
  onClose: () => void
}

export function AbandonmentPrompt({ repoId, repoName, open, onClose }: AbandonmentPromptProps) {
  const [selected, setSelected] = useState<AbandonmentReason | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      await updateAbandonmentReason(repoId, selected)
      toast.success('Reason saved to graveyard')
      onClose()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Why is {repoName} being shelved?</DialogTitle>
          <DialogDescription>
            Capturing the reason helps you avoid rebuilding the same idea.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-1.5 mt-1">
          {ABANDONMENT_REASONS.map(reason => (
            <button
              key={reason}
              onClick={() => setSelected(reason)}
              className={`text-left px-3 py-2 rounded-md text-sm border transition-colors ${
                selected === reason
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                  : 'border-border/60 hover:bg-muted/50'
              }`}
            >
              {reason}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          <Button size="sm" onClick={handleSave} disabled={!selected || saving} className="flex-1">
            {saving ? 'Saving…' : 'Save to Graveyard'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Skip</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
