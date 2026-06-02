'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app-error]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-6">
      <AlertTriangle className="w-10 h-10 text-amber-500" />
      <div>
        <p className="text-base font-semibold">Something went wrong</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {error.message?.includes('Unauthorized')
            ? 'Your session may have expired. Try refreshing the page.'
            : 'An unexpected error occurred. The team has been notified.'}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
