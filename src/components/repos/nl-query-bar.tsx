'use client'

import { useState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sparkles, X, Loader2 } from 'lucide-react'
import type { NLQueryFilters, NLQueryResult } from '@/app/api/nl-query/route'
import { toast } from 'sonner'

interface NLQueryBarProps {
  onFilters: (filters: NLQueryFilters | null, explanation: string | null) => void
}

export function NLQueryBar({ onFilters }: NLQueryBarProps) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeExplanation, setActiveExplanation] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit() {
    const q = question.trim()
    if (!q || loading) return

    setLoading(true)
    try {
      const res = await fetch('/api/nl-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })

      if (!res.ok) throw new Error('Query failed')

      const result: NLQueryResult = await res.json()
      onFilters(result.filters, result.explanation)
      setActiveExplanation(result.explanation)
    } catch {
      toast.error('Failed to process query — try rephrasing')
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setQuestion('')
    setActiveExplanation(null)
    onFilters(null, null)
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-500 pointer-events-none" />
          <Input
            ref={inputRef}
            placeholder='Ask in plain English — "repos not updated in 6 months" or "show my Next.js projects"'
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
          onClick={handleSubmit}
          disabled={loading || !question.trim()}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Ask
        </Button>
        {activeExplanation && (
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={handleClear} title="Clear AI filter">
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {activeExplanation && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
          <span>AI filtered: <em>{activeExplanation}</em></span>
          <button onClick={handleClear} className="underline hover:text-foreground">Clear</button>
        </div>
      )}
    </div>
  )
}
