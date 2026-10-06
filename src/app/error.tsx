'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[root-error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
      <AlertTriangle className="w-10 h-10 text-amber-500" />
      <div>
        <p className="text-base font-semibold">Something went wrong</p>
        <p className="text-sm text-muted-foreground mt-1">
          Please try refreshing the page.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  )
}
