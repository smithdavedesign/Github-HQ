'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { saveNotificationSettings, testNotificationWebhook } from '@/lib/actions/notifications'

interface NotificationSettingsProps {
  /** Masked saved URL (host/…last4), or null when none is saved. The full URL never reaches the browser. */
  savedWebhookHint: string | null
  initialThreshold: number
}

export function NotificationSettings({ savedWebhookHint, initialThreshold }: NotificationSettingsProps) {
  const [savedHint, setSavedHint] = useState(savedWebhookHint)
  const [editing, setEditing] = useState(!savedWebhookHint)
  const [newUrl, setNewUrl] = useState('')
  const [threshold, setThreshold] = useState(String(initialThreshold))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  async function save(url: string | null) {
    setSaving(true)
    try {
      await saveNotificationSettings(url, parseInt(threshold, 10) || 55)
      if (url === '') setSavedHint(null)
      else if (url) setSavedHint(`${new URL(url).host}/…${url.slice(-4)}`)
      if (url !== null) { setNewUrl(''); setEditing(url === '') }
      toast.success(url === '' ? 'Webhook removed' : 'Notification settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      // Sent by the server: the browser can't reach Slack (CSP, and Slack's webhooks have no CORS).
      // An empty URL tests the saved one.
      const r = await testNotificationWebhook(editing ? newUrl : '')
      if (r.ok) toast.success('Test webhook sent')
      else toast.error(r.error)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Webhook failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="webhook-url" className="text-sm font-medium">Webhook</label>
        <p className="text-xs text-muted-foreground">
          Health drops, agent PRs and security alerts are posted here. Works with Slack and Discord webhooks, Make, Zapier or any HTTPS endpoint.
        </p>
        {editing ? (
          <div className="flex flex-wrap gap-2">
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              className="flex-1 min-w-0 text-sm h-8"
            />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleTest} disabled={testing || !newUrl}>
              {testing ? 'Sending…' : 'Test'}
            </Button>
            {savedHint && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEditing(false); setNewUrl('') }}>Cancel</Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs" title="Saved webhook (hidden: the URL works like a password)">
              {savedHint}
            </code>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleTest} disabled={testing}>
              {testing ? 'Sending…' : 'Test'}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setEditing(true)}>Replace</Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-red-600 hover:text-red-600" onClick={() => save('')} disabled={saving}>Remove</Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="health-threshold" className="text-sm font-medium">Health alert threshold</label>
        <p className="text-xs text-muted-foreground">Alert when a repo&apos;s health drops below this score. Default: 55.</p>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" className="h-8 text-xs" onClick={() => save(editing && newUrl.trim() ? newUrl : null)} disabled={saving}>
          {saving ? 'Saving…' : 'Save notifications'}
        </Button>
        <p className="text-xs text-muted-foreground">The morning report email comes from the factory on your Mac.</p>
      </div>
    </div>
  )
}
