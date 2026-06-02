import { test as setup } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const AUTH_STATE_PATH = 'tests/setup/auth-state.json'

setup('create authenticated session', async ({ page }) => {
  const sql = neon(process.env.DATABASE_URL!)

  const users = await sql`SELECT id FROM users LIMIT 1`
  if (!users.length) throw new Error('No user in DB — sign in at least once first')

  const userId = users[0].id
  const sessionToken = crypto.randomUUID()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await sql`
    INSERT INTO sessions (session_token, user_id, expires)
    VALUES (${sessionToken}, ${userId}, ${expires})
    ON CONFLICT (session_token) DO UPDATE SET expires = EXCLUDED.expires
  `

  // Set the session cookie. Auth.js v5 database strategy stores the raw UUID token.
  await page.context().addCookies([{
    name: 'authjs.session-token',
    value: sessionToken,
    domain: 'localhost',
    path: '/',
    expires: Math.floor(expires.getTime() / 1000),
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }])

  // Navigate to trigger session validation — don't assert URL since the dev server
  // may redirect to /login if the session isn't accepted (e.g. first compile).
  // The cookie is still saved into storageState for tests that need it.
  await page.goto('/')
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

  // Save the authenticated state (cookies + localStorage)
  const dir = path.dirname(AUTH_STATE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  await page.context().storageState({ path: AUTH_STATE_PATH })
})
