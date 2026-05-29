'use server'

import { after } from 'next/server'
import { auth } from '@/lib/auth'
import { syncAllRepos } from '@/lib/github/sync'

export async function triggerSync(): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  // after() uses Vercel's waitUntil — the sync keeps running after the
  // response is returned to the client, surviving serverless function cleanup
  after(async () => {
    await syncAllRepos(userId)
  })
}
