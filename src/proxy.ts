import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const session = await auth()
  const { pathname } = request.nextUrl

  const protectedPaths = ['/repos', '/security', '/deployments', '/analytics']
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p))

  if (isProtected && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/repos/:path*', '/security', '/deployments', '/analytics'],
}
