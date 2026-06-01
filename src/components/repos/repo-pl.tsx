import { toNum } from '@/lib/utils'
import { DollarSign, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface CostItem { label: string; amount: number }

interface RepoPLProps {
  mrr: string | number | null
  monthlyCost: string | number | null
  costItems: CostItem[] | null
}

export function RepoPL({ mrr, monthlyCost, costItems }: RepoPLProps) {
  const mrrNum = toNum(mrr)
  const costs = costItems && costItems.length > 0
    ? costItems
    : monthlyCost && parseFloat(String(monthlyCost)) > 0
      ? [{ label: 'Monthly cost', amount: parseFloat(String(monthlyCost)) }]
      : []

  const totalCost = costs.reduce((s, c) => s + c.amount, 0)
  const monthlyProfit = mrrNum - totalCost
  const annualRevenue = mrrNum * 12
  const annualCost = totalCost * 12
  const annualProfit = monthlyProfit * 12
  const margin = mrrNum > 0 ? Math.round((monthlyProfit / mrrNum) * 100) : null

  if (mrrNum === 0 && costs.length === 0) return null

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">P&amp;L Summary</p>

      {/* Monthly */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Revenue</p>
          <p className="font-bold text-emerald-600">${mrrNum.toFixed(0)}/mo</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Costs</p>
          <p className="font-bold text-amber-600">${totalCost.toFixed(0)}/mo</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Profit</p>
          <div className="flex items-center gap-1">
            {monthlyProfit > 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              : monthlyProfit < 0 ? <TrendingDown className="w-3.5 h-3.5 text-red-500" />
              : <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
            <p className={`font-bold ${monthlyProfit > 0 ? 'text-emerald-600' : monthlyProfit < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              ${Math.abs(monthlyProfit).toFixed(0)}/mo
            </p>
          </div>
        </div>
      </div>

      {/* Cost breakdown */}
      {costs.length > 0 && (
        <div className="space-y-1 border-t border-border/40 pt-2">
          {costs.map((c, i) => (
            <div key={i} className="flex justify-between text-xs text-muted-foreground">
              <span>{c.label}</span>
              <span className="tabular-nums">${c.amount.toFixed(0)}/mo</span>
            </div>
          ))}
        </div>
      )}

      {/* Annual */}
      {(mrrNum > 0 || totalCost > 0) && (
        <div className="grid grid-cols-3 gap-3 text-xs border-t border-border/40 pt-2 text-muted-foreground">
          <div>
            <p>Annual revenue</p>
            <p className="font-semibold text-foreground">${annualRevenue.toFixed(0)}</p>
          </div>
          <div>
            <p>Annual cost</p>
            <p className="font-semibold text-foreground">${annualCost.toFixed(0)}</p>
          </div>
          <div>
            <p>Annual profit{margin !== null ? ` · ${margin}%` : ''}</p>
            <p className={`font-semibold ${annualProfit > 0 ? 'text-emerald-600' : annualProfit < 0 ? 'text-red-600' : 'text-foreground'}`}>
              ${Math.abs(annualProfit).toFixed(0)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
