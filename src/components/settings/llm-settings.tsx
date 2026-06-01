'use client'

import { useState, useTransition, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { saveLLMSettings, removeLLMKey, setLLMProvider } from '@/lib/actions/llm'
import type { LLMProvider } from '@/lib/ai/adapter'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Sparkles, Trash2, CheckCircle, AlertCircle } from 'lucide-react'

const PROVIDERS: { value: LLMProvider; label: string; hint: string }[] = [
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    hint: 'Recommended. Best at structured JSON, prompt caching reduces cost. Get key at console.anthropic.com',
  },
  {
    value: 'openai',
    label: 'GPT-4o (OpenAI)',
    hint: 'Uses gpt-4o for deep analysis and gpt-4o-mini for fast tasks. Get key at platform.openai.com',
  },
]

interface Props {
  initialProvider: LLMProvider
  keySource: 'user' | 'env' | null
}

export function LLMSettings({ initialProvider, keySource }: Props) {
  const router = useRouter()
  const [provider, setProvider] = useState<LLMProvider>(initialProvider)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [currentKeySource, setCurrentKeySource] = useState(keySource)
  const [isPending, startTransition] = useTransition()

  const providerMeta = PROVIDERS.find(p => p.value === provider)!

  // Sync server-provided keySource when navigating back to this page
  useEffect(() => { setCurrentKeySource(keySource) }, [keySource])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return
    setTesting(true)
    try {
      await saveLLMSettings(provider, apiKey.trim())
      toast.success(`${providerMeta.label} connected`)
      setApiKey('')
      setCurrentKeySource('user')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Key test failed — check it has the right permissions')
    } finally {
      setTesting(false)
    }
  }

  function handleProviderChange(p: LLMProvider) {
    if (p === provider) return  // no-op — prevent wiping key when clicking active provider
    setProvider(p)
    setApiKey('')
    startTransition(async () => {
      await setLLMProvider(p)
      setCurrentKeySource(null)
      router.refresh()
    })
  }

  function handleRemove() {
    startTransition(async () => {
      await removeLLMKey()
      setCurrentKeySource(null)
      toast.success('Key removed')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* Provider selector */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Provider</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleProviderChange(p.value)}
              className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                provider === p.value
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className={`w-3.5 h-3.5 shrink-0 ${provider === p.value ? 'text-indigo-500' : ''}`} />
                <span className="font-medium">{p.label}</span>
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{providerMeta.hint}</p>
      </div>

      {/* Key status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {currentKeySource === 'user' ? (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-sm text-emerald-600">Your key active</span>
            </>
          ) : currentKeySource === 'env' ? (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-sm text-emerald-600">App key active</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">env var</Badge>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-sm text-amber-600">No key — AI features disabled</span>
            </>
          )}
        </div>
        {currentKeySource === 'user' && (
          <Button size="sm" variant="ghost" onClick={handleRemove} disabled={isPending} className="text-destructive hover:text-destructive h-7 px-2">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Key input — shown when no user key set */}
      {currentKeySource !== 'user' && (
        <form onSubmit={handleSave} className="space-y-2">
          <Input
            type="password"
            placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="text-sm font-mono"
          />
          <Button type="submit" size="sm" disabled={!apiKey.trim() || testing} className="gap-1.5">
            <Sparkles className={`w-3.5 h-3.5 ${testing ? 'animate-pulse' : ''}`} />
            {testing ? 'Testing key…' : 'Save & verify'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Key is tested with a minimal call before saving.
            {currentKeySource === 'env' ? ' Saving a key here overrides the app default.' : ''}
          </p>
        </form>
      )}
    </div>
  )
}
