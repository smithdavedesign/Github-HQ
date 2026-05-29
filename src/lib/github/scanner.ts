import { db } from '@/lib/db'
import { techStack } from '@/lib/db/schema'
import type { OctokitClient } from './client'

interface ScanResult {
  documentationScore: number
  testingScore: number
}

export async function scanRepository(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  repoId: number,
): Promise<ScanResult> {
  const [packageJson, prismaSchema, dockerCompose, vercelJson, netlifyToml, readme, workflows] =
    await Promise.allSettled([
      fetchFileContent(octokit, owner, repo, 'package.json'),
      fetchFileContent(octokit, owner, repo, 'prisma/schema.prisma'),
      fetchFileContent(octokit, owner, repo, 'docker-compose.yml'),
      fetchFileContent(octokit, owner, repo, 'vercel.json'),
      fetchFileContent(octokit, owner, repo, 'netlify.toml'),
      fetchFileContent(octokit, owner, repo, 'README.md'),
      fetchDirectoryListing(octokit, owner, repo, '.github/workflows'),
    ])

  const pkg = packageJson.status === 'fulfilled' ? safeParseJson(packageJson.value) : null
  const prisma = prismaSchema.status === 'fulfilled' ? prismaSchema.value : null
  const docker = dockerCompose.status === 'fulfilled' ? dockerCompose.value : null
  const vercel = vercelJson.status === 'fulfilled' ? vercelJson.value : null
  const netlify = netlifyToml.status === 'fulfilled' ? netlifyToml.value : null
  const readmeContent = readme.status === 'fulfilled' ? readme.value : null
  const workflowFiles = workflows.status === 'fulfilled' ? workflows.value : []

  const allDeps: Record<string, unknown> = {
    ...(pkg?.dependencies as Record<string, unknown> | undefined ?? {}),
    ...(pkg?.devDependencies as Record<string, unknown> | undefined ?? {}),
  }

  const frontend = detectFrontend(pkg, allDeps)
  const backend = detectBackend(pkg, allDeps)
  const database = detectDatabase(allDeps, prisma, docker)
  const hosting = detectHosting(vercel, netlify, docker)
  const language = detectLanguage(pkg, allDeps)
  const testing = detectTesting(allDeps)
  const analytics = detectAnalytics(allDeps)
  const aiTools = detectAiTools(allDeps)
  const ciCd = workflowFiles.length > 0 ? 'GitHub Actions' : null

  // Upsert tech stack
  await db
    .insert(techStack)
    .values({ repoId, frontend, backend, database, hosting, language, testing, analytics, aiTools, ciCd })
    .onConflictDoUpdate({
      target: [techStack.repoId],
      set: { frontend, backend, database, hosting, language, testing, analytics, aiTools, ciCd, detectedAt: new Date() },
    })

  const documentationScore = scoreReadme(readmeContent)
  const testingScore = testing ? (hasTestFiles(allDeps) ? 100 : 50) : 0

  return { documentationScore, testingScore }
}

async function fetchFileContent(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  path: string,
): Promise<string> {
  const response = await octokit.rest.repos.getContent({ owner, repo, path })
  if ('content' in response.data && response.data.content) {
    return Buffer.from(response.data.content, 'base64').toString('utf-8')
  }
  throw new Error('Not a file')
}

async function fetchDirectoryListing(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  path: string,
): Promise<string[]> {
  const response = await octokit.rest.repos.getContent({ owner, repo, path })
  if (Array.isArray(response.data)) {
    return response.data.map((f) => f.name)
  }
  return []
}

function safeParseJson(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

function hasDep(deps: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    if (name in deps) return name
  }
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

function detectBackend(pkg: Record<string, unknown> | null, deps: Record<string, unknown>): string | null {
  if (!pkg) return null
  if (hasDep(deps, 'next')) return 'Server Actions'
  if (hasDep(deps, 'express')) return 'Express'
  if (hasDep(deps, 'fastify')) return 'Fastify'
  if (hasDep(deps, 'hono')) return 'Hono'
  if (hasDep(deps, 'koa')) return 'Koa'
  if (hasDep(deps, 'nestjs', '@nestjs/core')) return 'NestJS'
  if (pkg.main || pkg.bin) return 'Node'
  return null
}

function detectDatabase(
  deps: Record<string, unknown>,
  prismaSchema: string | null,
  dockerCompose: string | null,
): string | null {
  if (prismaSchema) {
    if (prismaSchema.includes('postgresql') || prismaSchema.includes('postgres')) return 'PostgreSQL'
    if (prismaSchema.includes('mysql')) return 'MySQL'
    if (prismaSchema.includes('mongodb')) return 'MongoDB'
    if (prismaSchema.includes('sqlite')) return 'SQLite'
  }
  if (hasDep(deps, '@supabase/supabase-js')) return 'Supabase'
  if (hasDep(deps, 'pg', '@neondatabase/serverless', 'postgres', 'drizzle-orm')) return 'PostgreSQL'
  if (hasDep(deps, 'mysql2', 'mysql')) return 'MySQL'
  if (hasDep(deps, 'mongoose', 'mongodb')) return 'MongoDB'
  if (hasDep(deps, 'better-sqlite3', 'sqlite3')) return 'SQLite'
  if (hasDep(deps, '@aws-sdk/client-dynamodb')) return 'DynamoDB'
  if (hasDep(deps, 'prisma', '@prisma/client')) return 'PostgreSQL' // most common Prisma target
  if (dockerCompose?.includes('postgres') || dockerCompose?.includes('mysql')) {
    return dockerCompose.includes('mysql') ? 'MySQL' : 'PostgreSQL'
  }
  return null
}

function detectHosting(
  vercelJson: string | null,
  netlifyToml: string | null,
  dockerCompose: string | null,
): string | null {
  if (vercelJson) return 'Vercel'
  if (netlifyToml) return 'Netlify'
  if (dockerCompose) return 'Docker'
  return null
}

function detectLanguage(pkg: Record<string, unknown> | null, deps: Record<string, unknown>): string | null {
  if (!pkg) return null
  if (hasDep(deps, 'typescript', 'ts-node')) return 'TypeScript'
  return 'JavaScript'
}

function detectTesting(deps: Record<string, unknown>): string | null {
  if (hasDep(deps, 'vitest')) return 'Vitest'
  if (hasDep(deps, 'jest', '@jest/core')) return 'Jest'
  if (hasDep(deps, 'cypress')) return 'Cypress'
  if (hasDep(deps, 'playwright', '@playwright/test')) return 'Playwright'
  if (hasDep(deps, 'mocha')) return 'Mocha'
  return null
}

function detectAnalytics(deps: Record<string, unknown>): string | null {
  if (hasDep(deps, 'posthog-js', 'posthog-node')) return 'PostHog'
  if (hasDep(deps, 'mixpanel', 'mixpanel-browser')) return 'Mixpanel'
  if (hasDep(deps, '@segment/analytics-next')) return 'Segment'
  if (hasDep(deps, '@vercel/analytics')) return 'Vercel Analytics'
  if (hasDep(deps, 'gtag', 'react-ga')) return 'Google Analytics'
  return null
}

function detectAiTools(deps: Record<string, unknown>): string | null {
  const tools: string[] = []
  if (hasDep(deps, '@anthropic-ai/sdk')) tools.push('Claude')
  if (hasDep(deps, 'openai')) tools.push('OpenAI')
  if (hasDep(deps, '@google/generative-ai')) tools.push('Gemini')
  if (hasDep(deps, 'langchain', '@langchain/core')) tools.push('LangChain')
  return tools.length > 0 ? tools.join(', ') : null
}

function hasTestFiles(deps: Record<string, unknown>): boolean {
  return !!(hasDep(deps, 'vitest', 'jest', '@jest/core', 'cypress', '@playwright/test', 'mocha'))
}

function scoreReadme(content: string | null): number {
  if (!content) return 0
  let score = 0
  const lower = content.toLowerCase()

  if (lower.includes('## installation') || lower.includes('## getting started') || lower.includes('## setup')) score += 25
  if (lower.includes('.env') || lower.includes('environment variable') || lower.includes('env.example')) score += 20
  if (lower.includes('screenshot') || lower.includes('![') || lower.includes('<img')) score += 20
  if (lower.includes('## architecture') || lower.includes('## how it works') || lower.includes('## design')) score += 20
  if (lower.includes('## contributing') || lower.includes('## contribute') || lower.includes('pull request')) score += 15

  return score
}
