import type { NextConfig } from 'next'

const dev = process.env.NODE_ENV !== 'production'
// Vercel's preview toolbar (vercel.live) only runs on preview deployments.
const preview = process.env.VERCEL_ENV === 'preview'

// No nonces yet: Next's inline hydration scripts need 'unsafe-inline'. The policy still blocks
// third-party scripts, plugins, framing by other sites and form posts to anywhere but GitHub
// OAuth (Chrome applies form-action to the redirect after the sign-in POST).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}${preview ? ' https://vercel.live' : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}${preview ? ' https://vercel.live wss://ws-us3.pusher.com' : ''}`,
  `frame-src ${preview ? 'https://vercel.live' : "'none'"}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://github.com",
  "object-src 'none'",
  ...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ')

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options',         value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',      value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
}

export default nextConfig
