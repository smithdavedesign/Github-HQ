'use client'

import { useState, useRef } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { updateRepoTags } from '@/lib/actions/repositories'
import { toast } from 'sonner'

interface TagEditorProps {
  repoId: number
  initialTags: string[]
}

export function TagEditor({ repoId, initialTags }: TagEditorProps) {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function save(newTags: string[]) {
    try {
      await updateRepoTags(repoId, newTags)
      setTags(newTags)
    } catch {
      toast.error('Failed to save tags')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      const tag = input.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      if (!tags.includes(tag)) save([...tags, tag])
      setInput('')
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      save(tags.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    save(tags.filter((t) => t !== tag))
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 min-h-9 p-1.5 rounded-md border bg-background cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 text-xs h-6">
          {tag}
          <button aria-label={`Remove tag ${tag}`} onClick={() => removeTag(tag)} className="hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded">
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}
      <Input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? 'Add tags (e.g. client-work, side-project)…' : ''}
        className="border-0 h-6 p-0 text-xs focus-visible:ring-0 flex-1 min-w-24 bg-transparent"
      />
    </div>
  )
}
