'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Star, StarOff } from 'lucide-react'
import { toggleFocused } from '@/lib/actions/repositories'
import { toast } from 'sonner'

interface FocusToggleProps {
  repoId: number
  initialFocused: boolean
}

export function FocusToggle({ repoId, initialFocused }: FocusToggleProps) {
  const [focused, setFocused] = useState(initialFocused)
  const [loading, setLoading] = useState(false)

  async function handleToggle() {
    setLoading(true)
    const next = !focused
    setFocused(next)
    try {
      await toggleFocused(repoId, next)
      toast.success(next ? 'Marked as focus project' : 'Removed from focus')
    } catch {
      setFocused(!next) // revert
      toast.error('Failed to update focus status')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant={focused ? 'default' : 'outline'}
      size="sm"
      className={`h-8 gap-1.5 text-xs ${focused ? 'bg-amber-500 hover:bg-amber-600 border-amber-500 text-white' : ''}`}
      onClick={handleToggle}
      disabled={loading}
    >
      {focused ? (
        <Star className="w-3.5 h-3.5 fill-current" />
      ) : (
        <StarOff className="w-3.5 h-3.5" />
      )}
      {focused ? 'Focused' : 'Set Focus'}
    </Button>
  )
}
