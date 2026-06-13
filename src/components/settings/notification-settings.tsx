'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { saveNotificationSettings } from '@/lib/actions/notifications'
import { sendWebhook } from '@/lib/notifications/webhook'

interface NotificationSettingsProps {
  initialWebhookUrl: string
  initialThreshold: number
}

export function NotificationSettings({ initialWebhookUrl, initialThreshold }: NotificationSettingsProps) {
  const [webhookUrl, setWebhookUrl] = useState(initialWebhookUrl)
  const [threshold, setThreshold] = useState(String(initialThreshold))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await saveNotificationSettings(webhookUrl, parseInt(threshold, 10) || 55)
      toast.success('Notification settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!webhookUrl) { toast.error('Enter a webhook URL first'); return }
    setTesting(true)
    try {
      await sendWebhook(webhookUrl, {
        eventType: 'test',
        title: 'RepoHQ webhook test',
        body: 'If you see this, your webhook is working.',
        timestamp: new Date().toISOString(),
      })
      toast.success('Test webhook sent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Webhook failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="webhook-url" className="text-sm font-medium">
          Webhook URL
        </label>
        <p className="text-xs text-muted-foreground">
          RepoHQ POSTs a JSON payload here on critical events — health drops, agent PRs, security alerts.
          Works with Slack incoming webhooks, Make, Zapier, or any HTTP endpoint.
        </p>
        <div className="flex gap-2">
          <Input
            id="webhook-url"
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            className="flex-1 text-sm h-8"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleTest}
            disabled={testing || !webhookUrl}
          >
            {testing ? 'Sending…' : 'Test'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="health-threshold" className="text-sm font-medium">
          Health alert threshold
        </label>
        <p className="text-xs text-muted-foreground">
          Notify when a repo&apos;s health score drops below this value. Default: 55.
        </p>
        <div className="flex items-center gap-3">
          <Input
            id="health-threshold"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            className="w-24 text-sm h-8"
          />
          <span className="text-xs text-muted-foreground">out of 100</span>
        </div>
      </div>

      <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save notifications'}
      </Button>
    </div>
  )
}
