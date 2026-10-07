import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Every route under the (app) layout. The layout also redirects without a user; this stops the
// request before any page code runs. Public routes (/login, /u/*, /api/*) aren't matched.
export async function proxy(request: NextRequest) {
  const session = await auth()
  // Check the user id, not just the session object: Auth.js can return a populated object on
  // configuration errors, so existence alone isn't proof of a signed-in user.
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/repos/:path*', '/security', '/deployments', '/analytics', '/feed', '/settings', '/agent-performance'],
}
