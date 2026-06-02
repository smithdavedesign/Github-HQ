import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUnreadNotifications, getUnreadCount } from '@/lib/actions/notifications'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const countOnly = searchParams.get('countOnly') === 'true'

  if (countOnly) {
    const count = await getUnreadCount()
    return NextResponse.json({ count })
  }

  const items = await getUnreadNotifications(20)
  return NextResponse.json({ items, count: items.length })
}
