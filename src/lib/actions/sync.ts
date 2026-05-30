'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { syncAllRepos } from '@/lib/github/sync'

export async function triggerSync(): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  after(async () => {
    await syncAllRepos(userId)
    // Bust the Next.js page cache so the next request fetches fresh data
    revalidatePath('/', 'layout')
  })
}
