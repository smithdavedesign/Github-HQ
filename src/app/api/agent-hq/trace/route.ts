import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { factoryAccess } from '@/lib/agents/factory-queue'
import { getTrace } from '@/lib/agents/agent-hq-data'

/** Step trace of one request (?requestId=) or one run (?runId=). Factory owner only. */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = factoryAccess(session.user.id)
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 })

  const url = new URL(request.url)
  const requestId = url.searchParams.get('requestId') ?? undefined
  const runId = url.searchParams.get('runId') ?? undefined
  if (!requestId && !runId) return NextResponse.json({ error: 'requestId or runId required' }, { status: 400 })

  const trace = await getTrace(session.user.id, { requestId, runId })
  if (!trace) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(trace, { headers: { 'Cache-Control': 'no-store' } })
}
