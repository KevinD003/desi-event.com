import { describe, expect, it } from 'vitest'

import { createTestApp } from './helpers/app.js'

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', checks: { database: true } })
    expect(typeof response.json().timestamp).toBe('string')

    await app.close()
  })

  it('omits the redis check when no redis client is injected', async () => {
    const { app } = await createTestApp()

    expect(response(await app.inject({ method: 'GET', url: '/health' })).checks).not.toHaveProperty(
      'redis',
    )

    await app.close()
  })

  it('stays in rotation but reports degraded when redis is down', async () => {
    const redis = {
      ping: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const { app } = await createTestApp({ redis })

    const result = await app.inject({ method: 'GET', url: '/health' })

    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject({
      status: 'degraded',
      checks: { database: true, redis: false },
    })

    await app.close()
  })

  it('answers 503 with the error envelope when the database is unreachable', async () => {
    const { app, prisma } = await createTestApp()
    prisma.$queryRaw = async () => {
      throw new Error('connection refused')
    }

    const result = await app.inject({ method: 'GET', url: '/health' })

    expect(result.statusCode).toBe(503)
    expect(result.json().error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 })

    await app.close()
  })
})

/**
 * @param {object} result An inject result.
 * @returns {object} Its parsed body.
 */
function response(result) {
  return result.json()
}
