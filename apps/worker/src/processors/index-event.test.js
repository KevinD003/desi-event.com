import { describe, it, expect } from 'vitest'

import { createIndexEventProcessor } from './index-event.js'
import { createProcessors } from './index.js'
import { createFakeLogger, createFakePrisma, EVENT_ID } from '../../tests/helpers/fakes.js'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

/**
 * @param {object} [data] Payload overrides.
 * @returns {object} A minimal BullMQ job.
 */
const job = (data = {}) => ({ name: 'index-event', id: '1', data: { eventId: EVENT_ID, ...data } })

describe('createIndexEventProcessor', () => {
  it('logs the update it would have made when no index is configured', async () => {
    const logger = createFakeLogger()

    const result = await createIndexEventProcessor({ logger })(job({ reason: 'event published' }))

    expect(result).toEqual({
      eventId: EVENT_ID,
      action: 'UPSERT',
      indexed: false,
      reason: 'event published',
    })
    expect(logger.at('info')[0].message).toContain('no index is configured')
  })

  it('defaults the action to UPSERT', async () => {
    const result = await createIndexEventProcessor()(job())
    expect(result.action).toBe('UPSERT')
  })

  it('calls upsert on a wired-in index', async () => {
    /** @type {Array<object>} */
    const calls = []
    const index = {
      upsert: async (eventId, payload) => calls.push({ op: 'upsert', eventId, payload }),
      delete: async (eventId) => calls.push({ op: 'delete', eventId }),
    }

    const result = await createIndexEventProcessor({ index })(job())

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ op: 'upsert', eventId: EVENT_ID })
    expect(result.indexed).toBe(true)
  })

  it('calls delete when the action says DELETE', async () => {
    /** @type {Array<object>} */
    const calls = []
    const index = {
      upsert: async () => calls.push({ op: 'upsert' }),
      delete: async (eventId) => calls.push({ op: 'delete', eventId }),
    }

    await createIndexEventProcessor({ index })(job({ action: 'DELETE', reason: 'unpublished' }))

    expect(calls).toEqual([{ op: 'delete', eventId: EVENT_ID }])
  })

  it('treats every index failure as retryable, because the index is a cache', async () => {
    const index = {
      upsert: async () => {
        throw new Error('connection refused')
      },
      delete: async () => {},
    }

    const error = await createIndexEventProcessor({ index })(job()).catch((thrown) => thrown)

    expect(error.name).toBe('RetryableJobError')
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.message).toContain('connection refused')
  })

  it.each([
    ['a missing event id', {}],
    ['a malformed event id', { eventId: 'NOT A CUID' }],
    ['an unknown action', { action: 'REINDEX' }],
  ])('rejects %s permanently', async (_label, data) => {
    const process = createIndexEventProcessor()

    await expect(process({ name: 'index-event', data })).rejects.toMatchObject({
      name: 'PermanentJobError',
      code: 'INVALID_JOB_PAYLOAD',
    })
  })
})

describe('createProcessors', () => {
  it('returns one processor per job name', () => {
    const processors = createProcessors({
      prisma: createFakePrisma(),
      providers: createInMemoryProviderRegistry(),
      logger: createFakeLogger(),
    })

    expect(Object.keys(processors).sort()).toEqual([
      'expire-holds',
      'index-event',
      'issue-tickets',
      'send-email',
    ])
    for (const processor of Object.values(processors)) expect(typeof processor).toBe('function')
  })

  it('wires the registry email slot through to the email processor', async () => {
    const providers = createInMemoryProviderRegistry()
    const processors = createProcessors({ prisma: createFakePrisma(), providers })

    await processors['send-email']({
      data: { to: 'buyer@example.com', template: 'EVENT_REMINDER' },
    })

    expect(providers.email.sent).toHaveLength(1)
  })

  it('works without a logger at all', async () => {
    const processors = createProcessors({
      prisma: createFakePrisma(),
      providers: createInMemoryProviderRegistry(),
    })

    await expect(processors['index-event'](job())).resolves.toMatchObject({ indexed: false })
  })
})
