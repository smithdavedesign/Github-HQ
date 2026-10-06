import type { NextConfig } from 'next'

const dev = process.env.NODE_ENV !== 'production'
// Vercel injects its toolbar (vercel.live) for signed-in team members on preview AND production
// deployments; these are the origins Vercel documents for it.
const toolbar = {
  script: ' https://vercel.live',
  connect: ' https://vercel.live wss://ws-us3.pusher.com',
  img: ' https://vercel.live https://vercel.com',
  style: ' https://vercel.live',
  font: ' https://vercel.live https://assets.vercel.com',
  frame: 'https://vercel.live',
}

// No nonces yet: Next's inline hydration scripts need 'unsafe-inline'. The policy still blocks
// third-party scripts, plugins, framing by other sites and form posts to anywhere but GitHub
// OAuth (Chrome applies form-action to the redirect after the sign-in POST).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}${toolbar.script}`,
  `style-src 'self' 'unsafe-inline'${toolbar.style}`,
  `img-src 'self' data: blob: https://avatars.githubusercontent.com${toolbar.img}`,
  `font-src 'self' data:${toolbar.font}`,
  `connect-src 'self'${dev ? ' ws: wss:' : ''}${toolbar.connect}`,
  `frame-src ${toolbar.frame}`,
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
