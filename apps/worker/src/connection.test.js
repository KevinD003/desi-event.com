import { describe, it, expect } from 'vitest'

import {
  REQUIRED_CONNECTION_OPTIONS,
  closeRedisConnection,
  createRedisConnection,
} from './connection.js'
import { createFakeLogger } from '../tests/helpers/fakes.js'

describe('createRedisConnection', () => {
  it('refuses to build a connection without a URL', () => {
    expect(() => createRedisConnection({ url: undefined })).toThrow(TypeError)
    expect(() => createRedisConnection({ url: '   ' })).toThrow(TypeError)
  })

  it('sets maxRetriesPerRequest to null, which BullMQ workers require', () => {
    expect(REQUIRED_CONNECTION_OPTIONS.maxRetriesPerRequest).toBeNull()
  })

  it('applies the required options even if a caller tries to override them', () => {
    const connection = createRedisConnection({
      url: 'redis://127.0.0.1:6379',
      redisOptions: { lazyConnect: true, maxRetriesPerRequest: 20 },
    })

    expect(connection.options.maxRetriesPerRequest).toBeNull()
    expect(connection.options.lazyConnect).toBe(true)
    connection.disconnect()
  })

  it('handles connection errors instead of letting them crash the process', async () => {
    const logger = createFakeLogger()
    const connection = createRedisConnection({
      url: 'redis://127.0.0.1:6379',
      logger,
      redisOptions: { lazyConnect: true },
    })

    expect(connection.listenerCount('error')).toBeGreaterThan(0)
    connection.emit('error', new Error('ECONNREFUSED'))
    connection.emit('end')

    expect(logger.at('error')[0].message).toBe('redis connection error')
    expect(logger.at('warn')[0].message).toBe('redis connection closed')

    connection.disconnect()
  })
})

describe('closeRedisConnection', () => {
  it('prefers a graceful quit', async () => {
    /** @type {string[]} */
    const calls = []

    await closeRedisConnection({
      quit: async () => calls.push('quit'),
      disconnect: () => calls.push('disconnect'),
    })

    expect(calls).toEqual(['quit'])
  })

  it('falls back to dropping the socket when quit fails, because shutdown must finish', async () => {
    /** @type {string[]} */
    const calls = []

    await expect(
      closeRedisConnection({
        quit: async () => {
          throw new Error('socket already gone')
        },
        disconnect: () => calls.push('disconnect'),
      }),
    ).resolves.toBeUndefined()

    expect(calls).toEqual(['disconnect'])
  })

  it('tolerates being handed nothing', async () => {
    await expect(closeRedisConnection(undefined)).resolves.toBeUndefined()
  })
})
