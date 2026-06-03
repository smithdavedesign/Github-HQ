'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleSectionProps {
  label: string
  storageKey: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function CollapsibleSection({ label, storageKey, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(false)

  // Read localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored !== null) setOpen(stored === 'true')
    setMounted(true)
  }, [storageKey])

  function toggle() {
    const next = !open
    setOpen(next)
    localStorage.setItem(storageKey, String(next))
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-3 pt-2 w-full group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} ${label} section`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground/70 transition-colors">
          {label}
        </p>
        <div className="flex-1 h-px bg-border/30" />
        {mounted && (
          open ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors shrink-0">
              Hide <ChevronDown className="w-3 h-3" />
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground/80 transition-colors shrink-0 font-medium">
              Show {label.toLowerCase()} <ChevronRight className="w-3 h-3" />
            </span>
          )
        )}
      </button>

      {open && (
        <div className="space-y-4 mt-4">
          {children}
        </div>
      )}
    </div>
  )
}
