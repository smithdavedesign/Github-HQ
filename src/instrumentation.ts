import type { Instrumentation } from 'next'

/**
 * Server errors from pages, server components and actions are counted for the system monitor
 * (src/lib/monitoring/server-errors.ts). Next's own control flow (notFound, redirect) carries a NEXT_ digest and
 * isn't an error.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : ''
  if (digest.startsWith('NEXT_')) return
  const { recordServerError } = await import('./lib/monitoring/server-errors')
  await recordServerError(context.routeType, request.path, err instanceof Error ? err.message : String(err))
}
