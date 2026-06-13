import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison for secrets/tokens.
 * Prevents timing-based enumeration of the correct value.
 * Returns false immediately if either argument is empty.
 */
export function secretsEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  // Pad the shorter buffer to the same length before comparing so timingSafeEqual
  // never throws on mismatched lengths. The length check at the end ensures false
  // is returned even if the padded comparison succeeds.
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b.padEnd(a.length, '\0'))
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf) && a.length === b.length
}
