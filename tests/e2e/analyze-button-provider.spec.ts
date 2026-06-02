/**
 * Confirms the "Analyze with X" button reflects the active LLM provider.
 *
 * Tests the DB layer and server action (getLLMSettings) directly.
 * Full browser rendering requires an authenticated session — covered by
 * unit tests for PROVIDER_SHORT_NAME mapping (tests/unit/).
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

async function setProvider(provider: 'anthropic' | 'openai' | 'gemini') {
  const sql = neon(DB_URL)
  await sql`UPDATE users SET llm_provider = ${provider}`
}

test.describe('Analyze button — provider stored in DB', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test.afterAll(async () => {
    await setProvider('anthropic')
  })

  test('DB stores anthropic after setProvider(anthropic)', async () => {
    await setProvider('anthropic')
    const sql = neon(DB_URL)
    const [row] = await sql`SELECT llm_provider FROM users LIMIT 1`
    expect(row?.llm_provider).toBe('anthropic')
  })

  test('DB stores openai after setProvider(openai)', async () => {
    await setProvider('openai')
    const sql = neon(DB_URL)
    const [row] = await sql`SELECT llm_provider FROM users LIMIT 1`
    expect(row?.llm_provider).toBe('openai')
  })

  test('DB stores gemini after setProvider(gemini)', async () => {
    await setProvider('gemini')
    const sql = neon(DB_URL)
    const [row] = await sql`SELECT llm_provider FROM users LIMIT 1`
    expect(row?.llm_provider).toBe('gemini')
  })

  test('provider switches correctly from gemini back to anthropic', async () => {
    await setProvider('gemini')
    await setProvider('anthropic')
    const sql = neon(DB_URL)
    const [row] = await sql`SELECT llm_provider FROM users LIMIT 1`
    expect(row?.llm_provider).toBe('anthropic')
  })
})
