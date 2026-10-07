import { describe, expect, it } from 'vitest'
import {
  JOB_PRIORITY, isFactoryJobName, manualJobOptions, parseWorkerStatus, producerConnection, redisOptionsFromUrl,
  requestJobOptions, scheduledJobTemplate, workerConnection,
} from '../../factory/lib/queue'
import { DEFAULT_SCHEDULES, loadConfig } from '../../factory/lib/config'

describe('queue contract (docs/agent-hq-migration-prd.md §6)', () => {
  it('parses Render external URLs with TLS and credentials', () => {
    expect(redisOptionsFromUrl('rediss://red-abc:s3cr%2Ft@oregon-keyvalue.render.com:6379')).toEqual({
      host: 'oregon-keyvalue.render.com', port: 6379, username: 'red-abc', password: 's3cr/t', tls: {},
    })
  })

  it('parses local URLs without TLS, with a db index', () => {
    expect(redisOptionsFromUrl('redis://127.0.0.1:6380/2')).toEqual({ host: '127.0.0.1', port: 6380, db: 2 })
    expect(redisOptionsFromUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379 })
  })

  it('rejects non-redis URLs', () => {
    expect(() => redisOptionsFromUrl('https://example.com')).toThrow(/redis:\/\//)
  })

  it('producers fail fast; the worker blocks', () => {
    expect(producerConnection('redis://h')).toMatchObject({ enableOfflineQueue: false, maxRetriesPerRequest: 1 })
    expect(workerConnection('redis://h')).toMatchObject({ maxRetriesPerRequest: null })
  })

  it('request jobs use the request id as job id (idempotent re-adds) and run first', () => {
    const o = requestJobOptions('req-1')
    expect(o.jobId).toBe('req-1')
    expect(o.priority).toBe(JOB_PRIORITY.request)
    expect(o.delay).toBeUndefined()
    expect(requestJobOptions('req-1', 60_000).delay).toBe(60_000)
    expect(JOB_PRIORITY.request).toBeLessThan(JOB_PRIORITY.cycle)
  })

  it('manual runs get unique ids; scheduled templates carry the trigger', () => {
    expect(manualJobOptions('cycle', new Date(1000)).jobId).toBe('manual-cycle-1000')
    expect(scheduledJobTemplate('report')).toMatchObject({ name: 'report', data: { trigger: 'schedule' }, opts: { priority: JOB_PRIORITY.report } })
  })

  it('only known job names are accepted', () => {
    expect(isFactoryJobName('request')).toBe(true)
    expect(isFactoryJobName('scout')).toBe(true)
    expect(isFactoryJobName('rm -rf')).toBe(false)
  })

  it('worker status parses or is null', () => {
    expect(parseWorkerStatus(null)).toBeNull()
    expect(parseWorkerStatus('not json')).toBeNull()
    expect(parseWorkerStatus('{"pid":1}')).toBeNull()
    expect(parseWorkerStatus('{"host":"mac","lastSeenAt":"2026-10-07T00:00:00Z","pid":1}')).toMatchObject({ host: 'mac' })
  })
})

describe('schedules (replace the launchd calendar)', () => {
  it('defaults reproduce the Night Shift v2 calendar', () => {
    expect(DEFAULT_SCHEDULES).toEqual({ cycle: '5 0-6,12,16,20-23 * * *', report: '45 6 * * *', scout: '10 17 * * 0' })
    expect(loadConfig({ FACTORY_CONFIG: '/nonexistent.json' } as unknown as NodeJS.ProcessEnv).schedules).toEqual(DEFAULT_SCHEDULES)
  })
})
