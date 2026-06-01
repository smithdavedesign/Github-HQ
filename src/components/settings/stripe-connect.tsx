'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { saveStripeKey, removeStripeKey, getStripeProducts, syncStripeMrr, mapStripeProduct } from '@/lib/actions/stripe'
import type { StripeProduct } from '@/lib/actions/stripe'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { CreditCard, RefreshCw, Trash2, Link as LinkIcon } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Repo { id: number; name: string; stripeProductId: string | null }

interface Props {
  connected: boolean
  repos: Repo[]
}

export function StripeConnect({ connected, repos }: Props) {
  const router = useRouter()
  const [apiKey, setApiKey] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(!connected)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [products, setProducts] = useState<StripeProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      await saveStripeKey(apiKey.trim())
      toast.success('Stripe connected')
      setApiKey('')
      setShowKeyInput(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect Stripe')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveKey() {
    startTransition(async () => {
      await removeStripeKey()
      toast.success('Stripe disconnected')
      setProducts([])
      setShowKeyInput(true)
      router.refresh()
    })
  }

  async function handleLoadProducts() {
    setLoadingProducts(true)
    try {
      const p = await getStripeProducts()
      setProducts(p)
      if (p.length === 0) toast.info('No active subscriptions found in Stripe')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch products')
    } finally {
      setLoadingProducts(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const { synced } = await syncStripeMrr()
      toast.success(`MRR synced for ${synced} repo${synced !== 1 ? 's' : ''}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleMap(repoId: number, stripeProductId: string | null) {
    try {
      await mapStripeProduct(repoId, stripeProductId === 'none' ? null : stripeProductId)
      toast.success('Mapping saved')
    } catch {
      toast.error('Failed to save mapping')
    }
  }

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Stripe</span>
          {connected
            ? <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 text-xs">Connected</Badge>
            : <Badge variant="outline" className="text-muted-foreground text-xs">Not connected</Badge>}
        </div>
        {connected && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync MRR'}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleRemoveKey} disabled={isPending} className="text-destructive hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* API key input */}
      {showKeyInput && !connected && (
        <form onSubmit={handleSaveKey} className="space-y-2">
          <Input
            type="password"
            placeholder="sk_live_... or sk_test_..."
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Use a restricted key with read access to Subscriptions and Products.{' '}
            <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              Create one →
            </a>
          </p>
          <Button type="submit" size="sm" disabled={!apiKey.trim() || saving}>
            {saving ? 'Connecting…' : 'Connect Stripe'}
          </Button>
        </form>
      )}

      {/* Product → Repo mapping */}
      {connected && (
        <div className="space-y-3">
          {products.length === 0 ? (
            <Button size="sm" variant="outline" onClick={handleLoadProducts} disabled={loadingProducts}>
              <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
              {loadingProducts ? 'Loading…' : 'Map products to repos'}
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Map Stripe products to repos — MRR auto-updates on sync</p>
              {products.map(product => {
                const currentMapping = repos.find(r => r.stripeProductId === product.id)
                return (
                  <div key={product.id} className="flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground">${product.mrr}/mo · {product.subscriberCount} subscriber{product.subscriberCount !== 1 ? 's' : ''}</p>
                    </div>
                    <Select
                      defaultValue={currentMapping?.id?.toString() ?? 'none'}
                      onValueChange={val => handleMap(val === 'none' ? 0 : parseInt(val), val === 'none' ? null : product.id)}
                    >
                      <SelectTrigger className="w-44 h-8 text-xs">
                        <SelectValue placeholder="Select repo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs text-muted-foreground">— unassigned —</SelectItem>
                        {repos.map(r => (
                          <SelectItem key={r.id} value={r.id.toString()} className="text-xs">{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
              <Button size="sm" onClick={handleSync} disabled={syncing} className="mt-2">
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Apply & sync MRR now'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
