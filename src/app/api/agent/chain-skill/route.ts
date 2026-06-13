import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { isGstackSkill } from '@/lib/actions/nexus-utils'
import type { GstackSkill } from '@/lib/actions/nexus-utils'
import { queueSuggestedSkill } from '@/lib/actions/nexus'
import { secretsEqual } from '@/lib/crypto-utils'

// OpenClaw heartbeat endpoint — allows the local OpenClaw instance to queue a gstack skill
// on behalf of a user without going through the browser auth flow.
// Auth: x-openclaw-chain-secret header matched against OPENCLAW_CHAIN_SECRET env var.
// Nexus tokens never leave the server — OpenClaw calls this route, not Nexus directly.

interface ChainSkillPayload {
  repoName:  string   // "owner/repo" full name
  skill:     GstackSkill
  objective: string
  userId?:   string   // optional override; falls back to REPOHQ_MCP_USER_ID
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-openclaw-chain-secret')
  const expected = process.env.OPENCLAW_CHAIN_SECRET
  if (!expected || !secret || !secretsEqual(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: ChainSkillPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { repoName, skill, objective, userId: payloadUserId } = payload
  if (!repoName || !objective) {
    return NextResponse.json({ error: 'repoName and objective are required' }, { status: 400 })
  }
  if (!isGstackSkill(skill)) {
    return NextResponse.json({ error: `Invalid skill "${skill}". Must be one of: investigate, review, qa-only, qa, ship, document-release, health, canary, retro` }, { status: 400 })
  }

  // Resolve userId: explicit payload → env fallback → error
  const userId = payloadUserId ?? process.env.REPOHQ_MCP_USER_ID
  if (!userId) {
    return NextResponse.json({ error: 'userId not provided and REPOHQ_MCP_USER_ID not set' }, { status: 400 })
  }

  try {
    // Verify user exists and has autoDispatch enabled
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, autoDispatchEnabled: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (!user.autoDispatchEnabled) {
      return NextResponse.json({ error: 'autoDispatch is not enabled for this user' }, { status: 403 })
    }

    // Resolve repoId from full name
    const repo = await db.query.repositories.findFirst({
      where: and(eq(repositories.userId, userId), eq(repositories.fullName, repoName)),
      columns: { id: true, fullName: true },
    })
    if (!repo) {
      return NextResponse.json({ error: `Repository ${repoName} not found for user` }, { status: 404 })
    }

    const taskId = await queueSuggestedSkill(userId, repo.id, repoName, skill, objective, 'openclaw-heartbeat')
    if (!taskId) {
      return NextResponse.json({ error: 'Task not queued — lifecycle blocked or Nexus unavailable' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, taskId, repoName, skill })
  } catch (err) {
    console.error('[chain-skill] unexpected error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
