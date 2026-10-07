/**
 * Browser flow suite setup: a fresh database, two signed-in users, an empty queue, and the real
 * factory worker running the scripted stand-in job (tests/flow/fixtures/fake-run.ts). Returns the
 * teardown, which stops the worker.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FLOW, closePools, createDatabase, factoryHome, flowEnv, resetRedis, seed, startWorker } from '../harness/flow'
import { E2E_DB, OTHER_STATE, OWNER_STATE, SEED_FILE, appEnv, type E2eSeed } from './env'

function storageState(sessionToken: string) {
  return {
    cookies: [{
      name: 'authjs.session-token', value: sessionToken, domain: 'localhost', path: '/',
      expires: Math.floor(Date.now() / 1000) + 6 * 3600, httpOnly: true, secure: false, sameSite: 'Lax' as const,
    }],
    origins: [],
  }
}

export default async function globalSetup() {
  await createDatabase(E2E_DB)
  const s = await seed(E2E_DB, { allowlisted: 3 })
  await resetRedis()
  await closePools()

  const name = (fullName: string) => fullName.split('/')[1]
  const ids = s.allowlistedRepoIds
  const data: E2eSeed = {
    ownerId: FLOW.ownerId,
    reportRepo: { id: ids[0], name: name(FLOW.allowlist[0]) },
    prRepo: { id: ids[1], name: name(FLOW.allowlist[1]) },
    controlsRepo: { id: ids[2], name: name(FLOW.allowlist[2]) },
    outsideRepo: { id: s.outsideRepoId, name: name(FLOW.outsideRepo) },
    otherRepo: { id: s.otherRepoId, name: name(FLOW.allowlistedRepo) },
  }
  mkdirSync(path.dirname(SEED_FILE), { recursive: true })
  writeFileSync(SEED_FILE, JSON.stringify(data, null, 2))
  writeFileSync(OWNER_STATE, JSON.stringify(storageState(s.ownerSession)))
  writeFileSync(OTHER_STATE, JSON.stringify(storageState(s.otherSession)))

  const home = factoryHome()
  const worker = await startWorker(flowEnv(E2E_DB, home, { TZ: appEnv().TZ }))

  return async () => {
    await worker.stop()
    rmSync(home.home, { recursive: true, force: true })
  }
}
