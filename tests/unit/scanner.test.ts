import { describe, it, expect } from 'vitest'

// Pure helper functions extracted from scanner logic for unit testing
// These mirror the detection logic in src/lib/github/scanner.ts

function hasDep(deps: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) { if (name in deps) return name }
  return null
}

function detectFrontend(pkg: Record<string, unknown> | null, deps: Record<string, unknown>): string | null {
  if (!pkg) return null
  if (hasDep(deps, 'next')) return 'Next.js'
  if (hasDep(deps, 'nuxt')) return 'Nuxt'
  if (hasDep(deps, '@sveltejs/kit')) return 'SvelteKit'
  if (hasDep(deps, 'svelte')) return 'Svelte'
  if (hasDep(deps, 'vue')) return 'Vue'
  if (hasDep(deps, '@angular/core')) return 'Angular'
  if (hasDep(deps, 'react', 'react-dom')) return 'React'
  if (hasDep(deps, 'astro')) return 'Astro'
  return null
}

function detectDatabase(deps: Record<string, unknown>, prisma: string | null, docker: string | null): string | null {
  if (prisma?.includes('postgresql') || prisma?.includes('postgres')) return 'PostgreSQL'
  if (prisma?.includes('mysql')) return 'MySQL'
  if (hasDep(deps, '@supabase/supabase-js')) return 'Supabase'
  if (hasDep(deps, 'pg', '@neondatabase/serverless', 'postgres', 'drizzle-orm')) return 'PostgreSQL'
  if (hasDep(deps, 'mysql2', 'mysql')) return 'MySQL'
  if (hasDep(deps, 'mongoose', 'mongodb')) return 'MongoDB'
  if (hasDep(deps, 'better-sqlite3', 'sqlite3')) return 'SQLite'
  if (docker?.includes('postgres')) return 'PostgreSQL'
  return null
}

function detectTesting(deps: Record<string, unknown>): string | null {
  if (hasDep(deps, 'vitest')) return 'Vitest'
  if (hasDep(deps, 'jest', '@jest/core')) return 'Jest'
  if (hasDep(deps, 'cypress')) return 'Cypress'
  if (hasDep(deps, 'playwright', '@playwright/test')) return 'Playwright'
  return null
}

function detectAiTools(deps: Record<string, unknown>): string | null {
  const tools: string[] = []
  if (hasDep(deps, '@anthropic-ai/sdk')) tools.push('Claude')
  if (hasDep(deps, 'openai')) tools.push('OpenAI')
  if (hasDep(deps, '@google/generative-ai')) tools.push('Gemini')
  return tools.length > 0 ? tools.join(', ') : null
}

function scoreReadme(content: string | null): number {
  if (!content) return 0
  let score = 0
  const lower = content.toLowerCase()
  if (lower.includes('## installation') || lower.includes('## getting started')) score += 25
  if (lower.includes('.env') || lower.includes('environment variable')) score += 20
  if (lower.includes('screenshot') || lower.includes('![')) score += 20
  if (lower.includes('## architecture') || lower.includes('## how it works')) score += 20
  if (lower.includes('## contributing') || lower.includes('pull request')) score += 15
  return score
}

describe('detectFrontend', () => {
  it('detects Next.js', () => {
    expect(detectFrontend({}, { next: '^15.0.0' })).toBe('Next.js')
  })
  it('detects React when no Next.js', () => {
    expect(detectFrontend({}, { react: '^18.0.0', 'react-dom': '^18.0.0' })).toBe('React')
  })
  it('detects Vue', () => {
    expect(detectFrontend({}, { vue: '^3.0.0' })).toBe('Vue')
  })
  it('detects SvelteKit over Svelte', () => {
    expect(detectFrontend({}, { '@sveltejs/kit': '^2.0.0', svelte: '^4.0.0' })).toBe('SvelteKit')
  })
  it('returns null for backend-only projects', () => {
    expect(detectFrontend({}, { express: '^4.0.0' })).toBeNull()
  })
  it('returns null when pkg is null', () => {
    expect(detectFrontend(null, {})).toBeNull()
  })
})

describe('detectDatabase', () => {
  it('detects PostgreSQL from prisma schema', () => {
    expect(detectDatabase({}, 'provider = "postgresql"', null)).toBe('PostgreSQL')
  })
  it('detects MySQL from prisma schema', () => {
    expect(detectDatabase({}, 'provider = "mysql"', null)).toBe('MySQL')
  })
  it('detects Supabase from deps', () => {
    expect(detectDatabase({ '@supabase/supabase-js': '^2' }, null, null)).toBe('Supabase')
  })
  it('detects PostgreSQL from drizzle-orm dep', () => {
    expect(detectDatabase({ 'drizzle-orm': '^0.30.0' }, null, null)).toBe('PostgreSQL')
  })
  it('detects MongoDB from mongoose', () => {
    expect(detectDatabase({ mongoose: '^8.0.0' }, null, null)).toBe('MongoDB')
  })
  it('detects PostgreSQL from docker-compose', () => {
    expect(detectDatabase({}, null, 'image: postgres:16')).toBe('PostgreSQL')
  })
  it('returns null when no database detected', () => {
    expect(detectDatabase({ lodash: '^4' }, null, null)).toBeNull()
  })
})

describe('detectTesting', () => {
  it('detects Vitest', () => {
    expect(detectTesting({ vitest: '^1.0.0' })).toBe('Vitest')
  })
  it('detects Jest', () => {
    expect(detectTesting({ jest: '^29.0.0' })).toBe('Jest')
  })
  it('prefers Vitest over Jest', () => {
    expect(detectTesting({ vitest: '^1', jest: '^29' })).toBe('Vitest')
  })
  it('detects Playwright', () => {
    expect(detectTesting({ '@playwright/test': '^1.40.0' })).toBe('Playwright')
  })
  it('returns null with no test framework', () => {
    expect(detectTesting({ express: '^4' })).toBeNull()
  })
})

describe('detectAiTools', () => {
  it('detects Claude', () => {
    expect(detectAiTools({ '@anthropic-ai/sdk': '^0.20.0' })).toBe('Claude')
  })
  it('detects OpenAI', () => {
    expect(detectAiTools({ openai: '^4.0.0' })).toBe('OpenAI')
  })
  it('detects multiple tools', () => {
    expect(detectAiTools({ '@anthropic-ai/sdk': '^0.20', openai: '^4' })).toBe('Claude, OpenAI')
  })
  it('returns null with no AI tools', () => {
    expect(detectAiTools({ react: '^18' })).toBeNull()
  })
})

describe('scoreReadme', () => {
  it('returns 0 for null readme', () => {
    expect(scoreReadme(null)).toBe(0)
  })
  it('returns 0 for empty readme', () => {
    expect(scoreReadme('')).toBe(0)
  })
  it('awards 25 for installation section', () => {
    expect(scoreReadme('## Installation\nnpm install')).toBe(25)
  })
  it('awards 20 for env variables mention', () => {
    expect(scoreReadme('copy .env.example to .env.local')).toBe(20)
  })
  it('awards 20 for screenshots', () => {
    expect(scoreReadme('![Screenshot](screenshot.png)')).toBe(20)
  })
  it('returns 100 for a fully documented readme', () => {
    const readme = `
## Installation
copy .env.example
![Screenshot](s.png)
## Architecture
## Contributing
pull request
    `
    expect(scoreReadme(readme)).toBe(100)
  })
})
