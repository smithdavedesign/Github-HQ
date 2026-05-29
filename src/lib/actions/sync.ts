'use server'

import { auth } from '@/lib/auth'
import { syncAllRepos } from '@/lib/github/sync'

export async function triggerSync(): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  // Run sync in the background — don't await so the action returns fast
  syncAllRepos(session.user.id).catch(() => {})
}
