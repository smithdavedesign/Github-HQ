import { AlertTriangle } from 'lucide-react'

/** Shown on every app page while scheduled data has stopped arriving (src/lib/health/freshness.ts). */
export function StaleDataBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      data-testid="stale-data-banner"
      className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300 sm:px-6"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  )
}
