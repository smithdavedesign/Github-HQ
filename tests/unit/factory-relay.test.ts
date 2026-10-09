import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

// The egress relay (factory/docker/egress-relay.mjs) against a fake LiteLLM that records what it receives.
let upstream: http.Server
let relay: ChildProcess
const received: { method: string; url: string; auth: string | undefined }[] = []
const RELAY_PORT = 47811
const RELAY = `http://127.0.0.1:${RELAY_PORT}`

beforeAll(async () => {
  upstream = http.createServer((req, res) => { received.push({ method: req.method!, url: req.url!, auth: req.headers.authorization }); res.end('{}') })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()))
  const port = (upstream.address() as AddressInfo).port
  relay = spawn(process.execPath, [path.join(__dirname, '../../factory/docker/egress-relay.mjs')], {
    env: { ...process.env, LITELLM_UPSTREAM: `http://127.0.0.1:${port}`, EGRESS_ALLOW_MODELS: 'free-agent', LITELLM_KEY: 'sk-real', RELAY_PORT: String(RELAY_PORT) },
  })
  await new Promise<void>((resolve, reject) => {
    relay.stdout!.on('data', d => { if (String(d).includes('relay →')) resolve() })
    relay.on('exit', code => reject(new Error(`relay exited ${code}`)))
  })
})
afterAll(() => { relay?.kill(); upstream?.close() })

const call = (method: string, url: string, body?: object) => fetch(`${RELAY}${url}`, {
  method, headers: { authorization: 'Bearer sk-repohq-sandbox', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
})

describe('sandbox model relay', () => {
  it('forwards an allowed model with the real key in place of the worker\'s placeholder', async () => {
    expect((await call('POST', '/v1/chat/completions', { model: 'free-agent' })).status).toBe(200)
    expect(received.at(-1)).toEqual({ method: 'POST', url: '/v1/chat/completions', auth: 'Bearer sk-real' })
  })
  it('refuses other models, and GET outside health and model lists', async () => {
    expect((await call('POST', '/v1/chat/completions', { model: 'cloud-smart' })).status).toBe(403)
    expect((await call('GET', '/key/info')).status).toBe(403)
    expect((await call('GET', '/global/spend')).status).toBe(403)
    expect((await call('GET', '/v1/models')).status).toBe(200)
    expect((await call('GET', '/health/liveliness')).status).toBe(200)
  })
})
