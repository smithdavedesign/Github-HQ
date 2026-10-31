import { describe, it, expect } from 'vitest'
import { asNeonClient, isLocalDatabase } from '../../factory/lib/sql-client'

describe('sql-client', () => {
  it('a localhost URL is a local Postgres, anything else Neon', () => {
    expect(isLocalDatabase('postgres://ci:ci@localhost:5432/ci')).toBe(true)
    expect(isLocalDatabase('postgresql://u@127.0.0.1/db')).toBe(true)
    expect(isLocalDatabase('postgres://localhost')).toBe(true)
    expect(isLocalDatabase('postgresql://u:p@ep-x-123.us-east-2.aws.neon.tech/neondb?sslmode=require')).toBe(false)
    expect(isLocalDatabase('postgresql://u:p@localhost.evil.example/db')).toBe(false)
  })
  it('a postgres-js client gets query(text, params) over unsafe', async () => {
    const calls: unknown[][] = []
    const pg = Object.assign(() => null, { unsafe: (text: string, params: unknown[]) => { calls.push([text, params]); return Promise.resolve([{ n: 1 }]) } })
    const client = asNeonClient(pg as never)
    expect(await client.query('SELECT $1::int AS n', [1])).toEqual([{ n: 1 }])
    expect(calls).toEqual([['SELECT $1::int AS n', [1]]])
  })
})
