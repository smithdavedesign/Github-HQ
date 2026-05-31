'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { updateRepoRevenue } from '@/lib/actions/repositories'
import { toast } from 'sonner'
import { DollarSign, TrendingUp } from 'lucide-react'

interface RevenueEditorProps {
  repoId: number
  initialMrr: string
  initialArr: string
  initialMonthlyCost: string
}

export function RevenueEditor({ repoId, initialMrr, initialArr, initialMonthlyCost }: RevenueEditorProps) {
  const [mrr, setMrr] = useState(initialMrr === '0' ? '' : initialMrr)
  const [arr, setArr] = useState(initialArr === '0' ? '' : initialArr)
  const [cost, setCost] = useState(initialMonthlyCost === '0' ? '' : initialMonthlyCost)
  const [saving, setSaving] = useState(false)

  const mrrNum = parseFloat(mrr || '0')
  const arrNum = parseFloat(arr || '0') || mrrNum * 12
  const costNum = parseFloat(cost || '0')
  const monthlyProfit = mrrNum - costNum
  const margin = mrrNum > 0 ? Math.round((monthlyProfit / mrrNum) * 100) : null

  async function handleSave() {
    setSaving(true)
    try {
      await updateRepoRevenue(repoId, {
        mrr: mrr || '0',
        arr: arr || '0',
        monthlyCost: cost || '0',
      })
      toast.success('Revenue data saved')
    } catch {
      toast.error('Failed to save revenue data')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Monthly Recurring Revenue (MRR)</label>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={mrr}
              onChange={(e) => setMrr(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Annual Recurring Revenue (ARR)</label>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder={mrrNum > 0 ? String(mrrNum * 12) : '0.00'}
              value={arr}
              onChange={(e) => setArr(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Monthly Cost</label>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* P&L summary */}
      {mrrNum > 0 && (
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-center gap-6 text-sm flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground">Monthly Profit</p>
              <p className={`font-bold text-lg ${monthlyProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${monthlyProfit.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ARR</p>
              <p className="font-bold text-lg">${(arr ? arrNum : mrrNum * 12).toFixed(2)}</p>
            </div>
            {margin !== null && (
              <div className="flex items-center gap-1">
                <TrendingUp className={`w-4 h-4 ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
                <div>
                  <p className="text-xs text-muted-foreground">Margin</p>
                  <p className={`font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{margin}%</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Revenue Data'}
      </Button>
    </div>
  )
}
