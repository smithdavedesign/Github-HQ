'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, DollarSign } from 'lucide-react'
import { updateCostItems } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import type { CostItem } from '@/lib/db/schema'

interface CostItemsEditorProps {
  repoId: number
  initialItems: CostItem[] | null | undefined
}

const COST_LABEL_SUGGESTIONS = [
  'Vercel', 'Netlify', 'Railway', 'Render', 'Fly.io',
  'AWS', 'Domain', 'Email', 'Neon', 'Supabase',
  'Claude', 'OpenAI', 'Stripe', 'Other',
]

export function CostItemsEditor({ repoId, initialItems }: CostItemsEditorProps) {
  const [items, setItems] = useState<CostItem[]>(
    initialItems && initialItems.length > 0 ? initialItems : [],
  )
  const [saving, setSaving] = useState(false)

  const total = items.reduce((s, i) => s + (i.amount || 0), 0)

  function addItem() {
    setItems(prev => [...prev, { label: '', amount: 0 }])
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateLabel(idx: number, label: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, label } : item))
  }

  function updateAmount(idx: number, raw: string) {
    const amount = parseFloat(raw) || 0
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, amount } : item))
  }

  async function handleSave() {
    const valid = items.filter(i => i.label.trim() && i.amount > 0)
    setSaving(true)
    try {
      await updateCostItems(repoId, valid)
      setItems(valid)
      toast.success('Cost breakdown saved')
    } catch {
      toast.error('Failed to save costs')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Break down monthly costs per service. Total auto-syncs to Monthly Cost.
        </p>
        {total > 0 && (
          <span className="text-sm font-semibold tabular-nums">
            Total: ${total.toFixed(2)}/mo
          </span>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-2">
          No cost line items yet. Add services below.
        </p>
      )}

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {/* Label with datalist for suggestions */}
            <div className="flex-1">
              <Input
                list={`cost-labels-${repoId}`}
                placeholder="Service (e.g. Vercel)"
                value={item.label}
                onChange={e => updateLabel(idx, e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            {/* Amount */}
            <div className="relative w-28">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={item.amount === 0 ? '' : item.amount}
                onChange={e => updateAmount(idx, e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeItem(idx)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Suggestions datalist (invisible, feeds the label inputs) */}
      <datalist id={`cost-labels-${repoId}`}>
        {COST_LABEL_SUGGESTIONS.map(s => <option key={s} value={s} />)}
      </datalist>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={addItem}>
          <Plus className="w-3.5 h-3.5" />
          Add service
        </Button>
        <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Costs'}
        </Button>
      </div>
    </div>
  )
}
