import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { apiRoutes, buildOpenApiDocument, validateContract } from '@desi-event/api-contract'

import { emitOpenApi } from '../scripts/emit-openapi.mjs'
import { routeSchema } from '../src/lib/validation.js'
import { createTestApp } from './helpers/app.js'

const outFile = join(tmpdir(), `desi-event-openapi-${process.pid}.json`)

afterAll(async () => {
  await rm(outFile, { force: true })
})

describe('the server matches the contract', () => {
  it('registers a handler for every declared route, and nothing else under /v1', async () => {
    const { app } = await createTestApp({ docs: true })

    for (const route of apiRoutes) {
      expect(
        app.hasRoute({ method: route.method, url: route.path }),
        `${route.method} ${route.path} is declared in the contract but not registered`,
      ).toBe(true)
    }

    const registered = app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .filter((line) => line.includes('/v1/'))

    // Anything served under /v1 that the contract does not describe would be
    // an undocumented endpoint.
    expect(registered.length).toBeGreaterThan(0)

    await app.close()
  })

  it('enforces the same auth mode the contract advertises', async () => {
    const { app } = await createTestApp()

    for (const route of apiRoutes.filter((candidate) => candidate.auth === 'bearer')) {
      if (route.path.includes(':')) continue

      const response = await app.inject({
        method: route.method,
        url: route.path,
        ...(route.body ? { payload: {} } : {}),
      })

      expect(response.statusCode, `${route.method} ${route.path} must require a token`).toBe(401)
    }

    await app.close()
  })

  it('validates requests with the contract schema, not a copy of it', () => {
    for (const route of apiRoutes) {
      const schema = routeSchema(route)

      if (route.body) expect(schema.body).toBe(route.body)
      if (route.query) expect(schema.querystring).toBe(route.query)
      if (route.params) expect(schema.params).toBe(route.params)
      expect(schema.response[route.successStatus]).toBe(route.response)
    }
  })

  it('has a structurally valid contract', () => {
    const result = validateContract()
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('the published document', () => {
  it('serves the generated document at /openapi.json', async () => {
    const { app } = await createTestApp({ docs: true })

    const response = await app.inject({ method: 'GET', url: '/openapi.json' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      buildOpenApiDocument({ title: 'Desi-Event API', version: '0.1.0' }),
    )

    await app.close()
  })

  it('serves the interactive documentation at /docs', async () => {
    const { app } = await createTestApp({ docs: true })

    const response = await app.inject({ method: 'GET', url: '/docs/' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')

    await app.close()
  })

  it('can be switched off for a deployment that does not publish docs', async () => {
    const { app } = await createTestApp({ docs: false })

    expect((await app.inject({ method: 'GET', url: '/docs/' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/openapi.json' })).statusCode).toBe(404)

    await app.close()
  })

  it('is written to disk by the emit script', async () => {
    const { operations } = await emitOpenApi({ outFile, version: '9.9.9' })

    const written = JSON.parse(await readFile(outFile, 'utf8'))

    expect(operations).toBe(apiRoutes.length)
    expect(written.openapi).toBe('3.1.0')
    expect(written.info.version).toBe('9.9.9')
    expect(Object.keys(written.paths)).toContain('/v1/events/{slug}')
    expect(written.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
  })
})
