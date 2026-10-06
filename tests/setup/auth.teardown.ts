import { test as teardown } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import * as fs from 'fs'

const AUTH_STATE_PATH = 'tests/setup/auth-state.json'

// Deletes the session auth.setup.ts created, so e2e runs don't leave live sessions behind.
teardown('delete the e2e session', async () => {
  if (!fs.existsSync(AUTH_STATE_PATH) || !process.env.DATABASE_URL) return
  const state = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8')) as { cookies?: { name: string; value: string }[] }
  const token = state.cookies?.find(c => c.name === 'authjs.session-token')?.value
  if (token) await neon(process.env.DATABASE_URL)`DELETE FROM sessions WHERE session_token = ${token}`
  fs.rmSync(AUTH_STATE_PATH)
})
