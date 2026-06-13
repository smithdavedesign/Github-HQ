import { timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const ENC_PREFIX = 'enc:'

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY env var is not set')
  const buf = Buffer.from(raw, 'hex')
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars). Generate with: openssl rand -hex 32')
  return buf
}

// Encrypts a plaintext string. Output format: enc:<iv_hex>:<authtag_hex>:<ciphertext_hex>
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

// Decrypts a value encrypted by encrypt(). Values without the enc: prefix are returned
// as-is to allow zero-downtime migration from plaintext records.
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext
  const parts = ciphertext.slice(ENC_PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted value format')
  const [ivHex, tagHex, dataHex] = parts
  const key = getKey()
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

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
