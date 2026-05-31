'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, CheckCircle2, Target } from 'lucide-react'
import { createGoal, deleteGoal, updateCustomGoalProgress, GOAL_PRESETS, type GoalType } from '@/lib/actions/goals'
import { toast } from 'sonner'
import type { Goal } from '@/lib/db/schema'

interface GoalManagerProps {
  initialGoals: Goal[]
}

export function GoalManager({ initialGoals }: GoalManagerProps) {
  const [goals, setGoals] = useState(initialGoals)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ type: 'mrr' as GoalType, name: '', target: '', deadline: '', notes: '' })
  const [loading, setLoading] = useState(false)

  const preset = GOAL_PRESETS[form.type]

  function handleTypeChange(type: GoalType) {
    setForm(f => ({ ...f, type, name: GOAL_PRESETS[type].label }))
  }

  async function handleCreate() {
    if (!form.target || !form.name) return
    setLoading(true)
    try {
      await createGoal({
        type: form.type,
        name: form.name,
        targetValue: parseFloat(form.target),
        unit: preset.unit,
        deadline: form.deadline || undefined,
        notes: form.notes || undefined,
      })
      toast.success('Goal created')
      setAdding(false)
      setForm({ type: 'mrr', name: '', target: '', deadline: '', notes: '' })
      // Refresh — revalidatePath handles the server but we need client refresh
      window.location.reload()
    } catch {
      toast.error('Failed to create goal')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteGoal(id)
      setGoals(prev => prev.filter(g => g.id !== id))
      toast.success('Goal removed')
    } catch {
      toast.error('Failed to remove goal')
    }
  }

  function pct(goal: Goal) {
    return Math.min(100, Math.round(((goal.currentValue ?? 0) / (goal.targetValue ?? 1)) * 100))
  }

  return (
    <div className="space-y-4">
      {/* Existing goals */}
      {goals.length > 0 && (
        <div className="space-y-2">
          {goals.map(goal => (
            <div key={goal.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-background">
              <Target className="w-4 h-4 text-indigo-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{goal.name}</p>
                  {goal.completedAt && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />Done
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 bg-muted rounded-full h-1 max-w-32">
                    <div
                      className="bg-indigo-500 h-1 rounded-full transition-all"
                      style={{ width: `${pct(goal)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {goal.unit === '$' ? `$${Math.round(goal.currentValue ?? 0).toLocaleString()} / $${Math.round(goal.targetValue).toLocaleString()}`
                      : `${Math.round(goal.currentValue ?? 0)} / ${Math.round(goal.targetValue)} ${goal.unit ?? ''}`}
                    {' '}({pct(goal)}%)
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(goal.id)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add goal form */}
      {adding ? (
        <div className="space-y-3 p-4 rounded-lg border border-dashed border-border">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Goal type</label>
              <Select value={form.type} onValueChange={v => handleTypeChange(v as GoalType)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GOAL_PRESETS).map(([type, meta]) => (
                    <SelectItem key={type} value={type} className="text-xs">{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Target ({preset.unit || 'amount'})</label>
              <div className="relative">
                {preset.unit === '$' && (
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                )}
                <Input
                  type="number"
                  min="0"
                  placeholder={preset.placeholder}
                  value={form.target}
                  onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                  className={`h-8 text-xs ${preset.unit === '$' ? 'pl-6' : ''}`}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Goal name</label>
            <Input
              placeholder={`e.g. Reach ${preset.unit === '$' ? '$' : ''}${form.target || preset.placeholder} ${preset.unit !== '$' ? preset.unit : ''}`.trim()}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">{preset.description}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Target date (optional)</label>
            <Input
              type="date"
              value={form.deadline}
              onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="h-8 text-xs gap-1" onClick={handleCreate} disabled={loading || !form.target || !form.name}>
              {loading ? 'Creating…' : 'Create Goal'}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5 border-dashed"
          onClick={() => { setAdding(true); setForm(f => ({ ...f, name: GOAL_PRESETS.mrr.label })) }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Goal
        </Button>
      )}
    </div>
  )
}
