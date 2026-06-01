import { ImageResponse } from 'next/og'
import { db } from '@/lib/db'
import { users, repositories, repositoryMetrics } from '@/lib/db/schema'
import { eq, and, avg, count } from 'drizzle-orm'

export const runtime = 'edge'
export const alt = 'RepoHQ Portfolio'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OGImage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params

  const user = await db.query.users.findFirst({
    where: and(eq(users.githubLogin, username), eq(users.publicProfile, true)),
    columns: { id: true, name: true, image: true },
  })

  if (!user) {
    return new ImageResponse(
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0f0f10', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#fff', fontSize: 32 }}>Portfolio not found</p>
      </div>,
      { ...size }
    )
  }

  // Fetch quick stats
  const [repoCount, avgHealthRows] = await Promise.all([
    db.select({ count: count() }).from(repositories)
      .where(and(eq(repositories.userId, user.id), eq(repositories.visibility, 'public'))),
    db.select({ avg: avg(repositoryMetrics.healthScore) }).from(repositoryMetrics)
      .innerJoin(repositories, eq(repositories.id, repositoryMetrics.repoId))
      .where(and(eq(repositories.userId, user.id), eq(repositories.visibility, 'public'))),
  ])

  const totalRepos = repoCount[0]?.count ?? 0
  const avgHealth = Math.round(parseFloat(String(avgHealthRows[0]?.avg ?? '0')))
  const displayName = user.name ?? username

  const healthColor = avgHealth >= 75 ? '#10b981' : avgHealth >= 55 ? '#f59e0b' : '#ef4444'

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #0f0f10 0%, #1a1a2e 100%)',
        padding: '60px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '48px' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M6 3a3 3 0 0 0-3 3v2.17a3 3 0 0 0 .879 2.122L6 12.414l2.121-2.121A3 3 0 0 0 9 8.17V6a3 3 0 0 0-3-3ZM18 3a3 3 0 0 0-3 3v2.17a3 3 0 0 0 .879 2.122L18 12.414l2.121-2.121A3 3 0 0 0 21 8.17V6a3 3 0 0 0-3-3Z" />
          </svg>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, fontWeight: 500 }}>RepoHQ</span>
      </div>

      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: 1 }}>
        <div style={{ flex: 1 }}>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 20, margin: '0 0 8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            GitHub Portfolio
          </p>
          <h1 style={{ color: '#ffffff', fontSize: 64, fontWeight: 700, margin: '0 0 8px', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            {displayName}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 24, margin: 0 }}>
            @{username}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '40px', marginTop: '48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#ffffff', fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{totalRepos}</span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16 }}>Public repos</span>
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: healthColor, fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{avgHealth}</span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16 }}>Avg health score</span>
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#4f46e5', fontSize: 44, fontWeight: 700, lineHeight: 1 }}>AI</span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16 }}>Monitored</span>
        </div>
      </div>
    </div>,
    { ...size }
  )
}
