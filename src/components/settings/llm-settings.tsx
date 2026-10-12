'use client'

import { useState, useTransition, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { saveLLMSettings, removeLLMKey, setLLMProvider } from '@/lib/actions/llm'
import type { LLMProvider } from '@/lib/ai/providers'
import { PROVIDER_KEY_HINTS, PROVIDER_LABELS, isPaidProvider } from '@/lib/ai/providers'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Sparkles, Trash2, CheckCircle, AlertCircle } from 'lucide-react'

const PROVIDERS: { value: LLMProvider; label: string; hint: string }[] = [
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    hint: 'Paid API: every call costs money. Best at structured JSON. Get key at console.anthropic.com',
  },
  {
    value: 'openai',
    label: 'GPT-4o (OpenAI)',
    hint: 'Paid API: every call costs money. Uses gpt-4o for deep analysis and gpt-4o-mini for fast tasks. Get key at platform.openai.com',
  },
  {
    value: 'gemini',
    label: 'Gemini (Google)',
    hint: '$0 on the free tier (a key from a Google project without billing). Uses the current Gemini Flash for analysis and Flash-Lite for fast tasks. Get key at aistudio.google.com',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter (free models)',
    hint: '$0: routes to currently-free models. Weaker at strict JSON; invalid output is repaired once, then retried on Gemini if the server has a Gemini key. Get key at openrouter.ai/keys',
  },
]

interface Props {
  initialProvider: LLMProvider
  keySource: 'user' | 'env' | null
  savedProviders: LLMProvider[]
  /** What AI calls use now (getLLMAdapter): differs from the choice when it's paid and paid is off. */
  effectiveProvider: LLMProvider | null
  paidAllowed: boolean
}

export function LLMSettings({ initialProvider, keySource, savedProviders: initialSavedProviders, effectiveProvider, paidAllowed }: Props) {
  const router = useRouter()
  const [provider, setProvider] = useState<LLMProvider>(initialProvider)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [currentKeySource, setCurrentKeySource] = useState(keySource)
  const [savedProviders, setSavedProviders] = useState<LLMProvider[]>(initialSavedProviders)
  const [isPending, startTransition] = useTransition()

  const providerMeta = PROVIDERS.find(p => p.value === provider)!
  // A paid provider chosen before the $0 rule: no key form, since it can't be saved or used.
  const locked = isPaidProvider(provider) && !paidAllowed

  // Sync server-provided state when navigating back to this page
  useEffect(() => { setCurrentKeySource(keySource) }, [keySource])
  useEffect(() => { setSavedProviders(initialSavedProviders) }, [initialSavedProviders])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return
    setTesting(true)
    try {
      await saveLLMSettings(provider, apiKey.trim())
      toast.success(`${providerMeta.label} connected`)
      setApiKey('')
      setCurrentKeySource('user')
      // Track locally that this provider now has a key
      setSavedProviders(prev => prev.includes(provider) ? prev : [...prev, provider])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Key test failed — check it has the right permissions')
    } finally {
      setTesting(false)
    }
  }

  function handleProviderChange(p: LLMProvider) {
    if (p === provider) return  // no-op
    setProvider(p)
    setApiKey('')
    // Restore "Your key active" if this provider already has a saved key,
    // otherwise show "No key" so the user can enter one.
    setCurrentKeySource(savedProviders.includes(p) ? 'user' : null)
    startTransition(async () => {
      await setLLMProvider(p)
      // No router.refresh() — avoids the race condition where a stale
      // server render overwrites the correct client state on Vercel.
    })
  }

  function handleRemove() {
    startTransition(async () => {
      await removeLLMKey()
      setCurrentKeySource(null)
      setSavedProviders(prev => prev.filter(p => p !== provider))
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
          {PROVIDERS.map(p => {
            const off = isPaidProvider(p.value) && !paidAllowed
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => handleProviderChange(p.value)}
                disabled={off}
                aria-pressed={provider === p.value}
                title={off ? 'Paid API: off while RepoHQ runs at $0 (LLM_ALLOW_PAID=1 turns it on)' : undefined}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  provider === p.value
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className={`w-3.5 h-3.5 shrink-0 ${provider === p.value ? 'text-indigo-500' : ''}`} aria-hidden />
                  <span className="font-medium">{p.label}</span>
                  {isPaidProvider(p.value) && <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">{off ? 'paid · off' : 'paid'}</Badge>}
                </div>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{providerMeta.hint}</p>
        {effectiveProvider !== provider && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {effectiveProvider
              ? `AI features use ${PROVIDER_LABELS[effectiveProvider]}: ${providerMeta.label} is ${isPaidProvider(provider) && !paidAllowed ? 'a paid API, and RepoHQ runs at $0' : 'missing a key'}.`
              : 'AI features are off: no free provider has a key. Pick OpenRouter or Gemini above and add its key.'}
          </p>
        )}
      </div>

      {/* Key status */}
      {!locked && <div className="flex items-center justify-between">
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
              <span className="text-sm text-amber-600">{effectiveProvider ? `No ${providerMeta.label} key yet` : 'No key — AI features disabled'}</span>
            </>
          )}
        </div>
        {currentKeySource === 'user' && (
          <Button size="sm" variant="ghost" onClick={handleRemove} disabled={isPending} className="text-destructive hover:text-destructive h-7 px-2">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>}

      {/* Key input — shown when no user key set */}
      {!locked && currentKeySource !== 'user' && (
        <form onSubmit={handleSave} className="space-y-2">
          <Input
            type="password"
            placeholder={PROVIDER_KEY_HINTS[provider]}
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
