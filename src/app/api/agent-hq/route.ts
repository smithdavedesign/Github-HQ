import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { factoryAccess } from '@/lib/agents/factory-queue'
import { getAgentHqOverview } from '@/lib/agents/agent-hq-data'

/** Agents page live data: worker, queue, schedulers, recent runs and requests. Factory owner only. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = factoryAccess(session.user.id)
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 })
  return NextResponse.json(await getAgentHqOverview(session.user.id), { headers: { 'Cache-Control': 'no-store' } })
}
