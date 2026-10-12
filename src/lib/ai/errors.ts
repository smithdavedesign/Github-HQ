/**
 * Provider errors in words the owner can act on. The advisor and CEO report used to log a free
 * tier's "429 Rate limit exceeded: free-models-per-day" as "model returned non-JSON response",
 * and show nothing at all. Pure.
 */
import { NO_FREE_PROVIDER } from './providers'

export function describeAiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : null
  if (message.includes(NO_FREE_PROVIDER)) return NO_FREE_PROVIDER
  if (/free-models-per-day/i.test(message)) {
    return "OpenRouter's free daily limit is used up (50 requests a day, shared with everything else using the key). It resets at midnight UTC."
  }
  if (status === 429 || /\b429\b|rate limit|quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return 'The AI provider is rate-limiting requests. Try again in a few minutes.'
  }
  if (status === 401 || status === 403 || /\b(401|403)\b|invalid api key|unauthori[sz]ed|permission/i.test(message)) {
    return 'The AI provider rejected the key. Check it in Settings → AI provider.'
  }
  if (/non-JSON|JSON|Unexpected token|expected a JSON/i.test(message)) {
    return "The model's answer wasn't usable (tried a repair and the fallback). Try again; free models vary."
  }
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(message)) return 'The AI provider timed out. Try again.'
  return message.slice(0, 300) || 'The AI call failed.'
}
