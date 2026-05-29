import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deployments } from '@/lib/db/schema'
import { checkAllDeployments } from '@/lib/monitoring/uptime'
import { eq } from 'drizzle-orm'

function verifyCronSecret(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allDeployments = await db.query.deployments.findMany({
    columns: { id: true, url: true },
  })

  const results = await checkAllDeployments(allDeployments)

  for (const result of results) {
    await db
      .update(deployments)
      .set({
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        httpStatus: result.httpStatus,
        sslValid: result.sslValid,
        lastChecked: new Date(),
      })
      .where(eq(deployments.id, result.id))
  }

  return NextResponse.json({ ok: true, checked: results.length })
}
