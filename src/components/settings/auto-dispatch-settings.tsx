'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Bot, Shield, Zap, AlertTriangle } from 'lucide-react'

interface AutoDispatchSettingsProps {
  initialEnabled: boolean
  initialEffortGate: string
  initialMaxPerRun: number
  initialSkipSecurity: boolean
  initialAccuracyThreshold: number
}

async function saveAutoDispatchSettings(settings: {
  autoDispatchEnabled: boolean
  autoDispatchEffortGate: string
  autoDispatchMaxPerRun: number
  autoDispatchSkipSecurity: boolean
  autoDispatchAccuracyThreshold: number
}) {
  const { saveAutoDispatch } = await import('@/lib/actions/auto-dispatch-settings')
  return saveAutoDispatch(settings)
}

export function AutoDispatchSettings({
  initialEnabled,
  initialEffortGate,
  initialMaxPerRun,
  initialSkipSecurity,
  initialAccuracyThreshold,
}: AutoDispatchSettingsProps) {
  const [enabled, setEnabled]                     = useState(initialEnabled)
  const [effortGate, setEffortGate]               = useState(initialEffortGate)
  const [maxPerRun, setMaxPerRun]                 = useState(String(initialMaxPerRun))
  const [skipSecurity, setSkipSecurity]           = useState(initialSkipSecurity)
  const [accuracyThreshold, setAccuracyThreshold] = useState(String(initialAccuracyThreshold))
  const [saving, setSaving]                       = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await saveAutoDispatchSettings({
        autoDispatchEnabled:           enabled,
        autoDispatchEffortGate:        effortGate,
        autoDispatchMaxPerRun:         Math.min(10, Math.max(1, parseInt(maxPerRun, 10) || 3)),
        autoDispatchSkipSecurity:      skipSecurity,
        autoDispatchAccuracyThreshold: parseInt(accuracyThreshold, 10) || 0,
      })
      toast.success('Auto-dispatch settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Enable auto-dispatch</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            On Monday, the advisor automatically queues eligible actions — you wake up with PRs ready to review.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="space-y-4 pl-0.5">
          {/* Warning */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2.5 flex gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Auto-dispatched tasks run automatically. Review the PRs before merging — the agent may make mistakes.</span>
          </div>

          {/* Effort gate */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-indigo-500" />
              Effort gate
            </label>
            <Select value={effortGate} onValueChange={setEffortGate}>
              <SelectTrigger className="h-8 text-sm w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick_only">Quick only (&lt; 30 min)</SelectItem>
                <SelectItem value="quick_and_medium">Quick + Medium (up to 4h)</SelectItem>
                <SelectItem value="all">All efforts (including 1+ day tasks)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Substantial tasks are high-risk — &quot;Quick only&quot; is recommended to start.</p>
          </div>

          {/* Max per run */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Max tasks per Monday</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={10}
                value={maxPerRun}
                onChange={e => setMaxPerRun(e.target.value)}
                className="h-8 text-sm w-20"
              />
              <span className="text-xs text-muted-foreground">tasks (max 10)</span>
            </div>
          </div>

          {/* Skip security */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-red-500" />
                Skip security tasks
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Security fixes can have unintended side-effects. Recommended: keep this on and queue security tasks manually.
              </p>
            </div>
            <Switch checked={skipSecurity} onCheckedChange={setSkipSecurity} />
          </div>

          {/* Accuracy threshold */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-emerald-500" />
              Minimum accuracy threshold
            </label>
            <Select value={accuracyThreshold} onValueChange={setAccuracyThreshold}>
              <SelectTrigger className="h-8 text-sm w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No threshold (always dispatch)</SelectItem>
                <SelectItem value="50">50% — dispatch if more likely to succeed than fail</SelectItem>
                <SelectItem value="75">75% — only well-proven action types</SelectItem>
                <SelectItem value="80">80% — high confidence only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Action types with fewer runs than the minimum required for signal are always dispatched regardless of this setting.
            </p>
          </div>
        </div>
      )}

      <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save auto-dispatch'}
      </Button>
    </div>
  )
}
