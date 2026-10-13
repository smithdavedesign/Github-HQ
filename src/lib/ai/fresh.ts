/**
 * Whether the Advisor or CEO report stored on a digest row is recent enough to show (pure), by the
 * content's own `generatedAt`. Both are written onto the newest digest row, which can be weeks old:
 * from 2026-08-17 to 2026-10-12 no digest was written, so each fresh Advisor and CEO report was
 * judged by August's date and its card showed nothing.
 */
export function freshContent<T extends { generatedAt?: string }>(content: T | null | undefined, digestAt: Date | null | undefined, now = new Date(), maxAgeMs = 8 * 24 * 60 * 60 * 1000): T | null {
  if (!content) return null
  const at = Date.parse(content.generatedAt ?? '') || digestAt?.getTime() || 0
  return now.getTime() - at > maxAgeMs ? null : content
}
