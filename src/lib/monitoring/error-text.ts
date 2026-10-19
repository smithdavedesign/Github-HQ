/**
 * Labels for a recorded server error (pure): a bounded route pattern and a message with nothing secret-shaped in it.
 * Same rules as botchelor's lib/errors.ts.
 */

/** The route with ids stripped ("/repos/123" → "/repos/:id"), no query. */
export function routePattern(path: string): string {
  const bare = path.split('?')[0] || '/'
  return bare
    .split('/')
    .map(seg => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 120)
}

/** The message without connection strings, bearer tokens or long keys, cut short. */
export function cleanMessage(message: string): string {
  return message
    .replace(/postgres(ql)?:\/\/\S+/gi, 'postgres://…')
    .replace(/\bBearer\s+\S+/gi, 'Bearer …')
    .replace(/\b(sk|rk|pk|whsec|ghp|gho|ghs)_[A-Za-z0-9_]{8,}/g, '$1_…')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}
