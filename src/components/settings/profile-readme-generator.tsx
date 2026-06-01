'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check, ExternalLink, RefreshCw } from 'lucide-react'

interface Props {
  username: string
  previewMarkdown: string
}

export function ProfileReadmeGenerator({ username, previewMarkdown }: Props) {
  const [copied, setCopied] = useState(false)
  const [markdown, setMarkdown] = useState(previewMarkdown)
  const [refreshing, setRefreshing] = useState(!previewMarkdown)

  useEffect(() => {
    if (!previewMarkdown) handleRefresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCopy() {
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/profile-readme/${username}`)
      if (res.ok) setMarkdown(await res.text())
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Auto-generated from your top repos, focus projects, and portfolio stats.
        Paste this into your GitHub profile README (<code className="text-xs bg-muted px-1 py-0.5 rounded">{username}/{username}</code> repo).
      </p>

      <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-auto max-h-48 whitespace-pre-wrap border border-border/40 font-mono">
        {markdown}
      </pre>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleCopy} variant="outline" className="gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy markdown'}
        </Button>
        <Button size="sm" onClick={handleRefresh} variant="ghost" disabled={refreshing} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <a
          href={`https://github.com/${username}/${username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          Open profile README <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}
