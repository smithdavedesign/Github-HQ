import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ApprovalTokenPayload {
  taskId: string
  repo?: string
  action: string
  reason?: string
  estimatedCostUsd?: number
  owner?: string
}

interface ApprovalTokenEnvelope {
  payload: ApprovalTokenPayload
  issuedAt: number
  expiresAt: number
  nonce: string
  signature: string
}

const approvedTokens = new Map<string, { used: boolean; expiresAt: number }>()

function getApprovalSecret(): string {
  return process.env.APPROVAL_TOKEN_SECRET ?? process.env.ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET ?? 'repohq-dev-approval-secret'
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function createSignature(serialized: string): string {
  return createHmac('sha256', getApprovalSecret()).update(serialized).digest('hex')
}

function normalizeToken(token: string): ApprovalTokenEnvelope {
  if (!token) {
    throw new Error('Approval token is missing')
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(token)) as Partial<ApprovalTokenEnvelope>
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Approval token is invalid')
    }

    const { payload, issuedAt, expiresAt, nonce, signature } = parsed
    if (!payload || typeof payload !== 'object' || !payload.taskId || !payload.action || typeof issuedAt !== 'number' || typeof expiresAt !== 'number' || typeof nonce !== 'string' || typeof signature !== 'string') {
      throw new Error('Approval token is invalid')
    }

    const serialized = JSON.stringify({ payload, issuedAt, expiresAt, nonce })
    const expected = createSignature(serialized)
    const actual = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
      throw new Error('Approval token is invalid')
    }

    return { payload: payload as ApprovalTokenPayload, issuedAt, expiresAt, nonce, signature }
  } catch {
    throw new Error('Approval token is invalid')
  }
}

export function issueApprovalToken(payload: ApprovalTokenPayload, options: { expiresInMs?: number; now?: Date } = {}): string {
  const now = options.now ?? new Date()
  const expiresAt = now.getTime() + (options.expiresInMs ?? 24 * 60 * 60 * 1000)
  const issuedAt = now.getTime()
  const nonce = `${issuedAt}-${Math.random().toString(16).slice(2)}`
  const envelope = { payload, issuedAt, expiresAt, nonce }
  const serialized = JSON.stringify(envelope)
  const signature = createSignature(serialized)
  const token = encodeBase64Url(JSON.stringify({ ...envelope, signature }))
  approvedTokens.set(token, { used: false, expiresAt })
  return token
}

export function verifyApprovalToken(token: string, options: { now?: Date } = {}): ApprovalTokenPayload {
  const envelope = normalizeToken(token)
  const now = options.now ?? new Date()
  if (now.getTime() > envelope.expiresAt) {
    throw new Error('Approval token expired')
  }

  const cached = approvedTokens.get(token)
  if (cached && cached.used) {
    throw new Error('Approval token has already been used')
  }

  return envelope.payload
}

export function consumeApprovalToken(token: string, options: { now?: Date } = {}): ApprovalTokenPayload {
  const payload = verifyApprovalToken(token, options)
  const envelope = normalizeToken(token)
  approvedTokens.set(token, { used: true, expiresAt: envelope.expiresAt })
  return payload
}

export function buildApprovalUrl(baseUrl: string, payload: ApprovalTokenPayload, options: { expiresInMs?: number; now?: Date } = {}): string {
  const normalized = baseUrl.replace(/\/$/, '')
  const token = issueApprovalToken(payload, options)
  return `${normalized}/approve/${encodeURIComponent(token)}`
}
