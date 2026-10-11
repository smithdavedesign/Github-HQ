'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/**
 * Steps through the ideas that need a call (← → or J K), so a review session is: read, press A/T/P,
 * confirm, and the next idea opens. Off the queue (an idea already decided) it just links back.
 */
export function ReviewNav({ position, total, prevSlug, nextSlug }: { position: number | null; total: number; prevSlug: string | null; nextSlug: string | null }) {
  const router = useRouter()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return
      const k = e.key.toLowerCase()
      if ((k === 'arrowleft' || k === 'k') && prevSlug) router.push(`/ideas/${prevSlug}`)
      else if ((k === 'arrowright' || k === 'j') && nextSlug) router.push(`/ideas/${nextSlug}`)
      else if (k === 'escape' || k === 'u') router.push('/ideas')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, prevSlug, nextSlug])

  if (position === null || total === 0) return null
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <NavButton slug={prevSlug} label="Previous idea to review"><ChevronLeft /></NavButton>
      <span className="tabular-nums">{position} of {total} to review</span>
      <NavButton slug={nextSlug} label="Next idea to review"><ChevronRight /></NavButton>
    </div>
  )
}

function NavButton({ slug, label, children }: { slug: string | null; label: string; children: React.ReactNode }) {
  if (!slug) return <Button variant="ghost" size="icon-sm" disabled aria-label={label}>{children}</Button>
  return <Button variant="ghost" size="icon-sm" asChild aria-label={label}><Link href={`/ideas/${slug}`}>{children}</Link></Button>
}
