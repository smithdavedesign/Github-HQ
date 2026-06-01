'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { updateHoursPerWeek } from '@/lib/actions/repositories'
import { toast } from 'sonner'

export function HoursInput({ initialHours }: { initialHours: number }) {
  const [hours, setHours] = useState(String(initialHours))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const val = parseInt(hours)
    if (isNaN(val) || val < 1 || val > 168) return
    setSaving(true)
    try {
      await updateHoursPerWeek(val)
      toast.success(`Time allocation set to ${val}h/week`)
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Hours available per week</label>
      <div className="flex gap-2 items-center">
        <Input
          type="number"
          min={1}
          max={80}
          value={hours}
          onChange={e => setHours(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          className="h-8 w-20 text-sm"
        />
        <span className="text-xs text-muted-foreground">hours</span>
        <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Used by the Time Allocation card to estimate how many sessions a recommendation requires
      </p>
    </div>
  )
}
