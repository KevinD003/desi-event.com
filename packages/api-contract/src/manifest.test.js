import { describe, expect, it } from 'vitest'

import { apiRoutes } from './routes.js'
import { apiRouteManifest } from './route-manifest.js'
import { routeManifestSource, toManifestEntry } from './manifest.js'

describe('the browser route manifest', () => {
  it('describes exactly the routes the contract declares', () => {
    // Generated, not maintained. A route added to the contract and not
    // regenerated here would be a route the browser client cannot call, and
    // the failure would surface as "Unknown route id" at runtime.
    expect(apiRouteManifest.map((entry) => entry.id)).toEqual(apiRoutes.map((route) => route.id))
  })

  it('is byte-identical to what the emitter would write', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('./route-manifest.js', import.meta.url), 'utf8')

    expect(source).toBe(routeManifestSource(apiRoutes))
  })

  it('carries the four things a client needs and nothing else', () => {
    for (const entry of apiRouteManifest) {
      expect(Object.keys(entry).sort()).toEqual(['auth', 'body', 'id', 'method', 'path', 'query'])
    }
  })

  it('carries no schema, which is the entire point', () => {
    // The schemas describe every column of every entity. A browser placing a
    // request needs to know whether there *is* a body, not what shape it has.
    const serialised = JSON.stringify(apiRouteManifest)

    expect(serialised).not.toMatch(/contactEmail/)
    expect(serialised).not.toMatch(/payoutCurrency/)
    expect(serialised).not.toMatch(/passwordHash/)
    expect(serialised).not.toMatch(/_def|zod|ZodObject/i)
  })

  it('says whether a route takes a body, matching the contract', () => {
    for (const route of apiRoutes) {
      const entry = apiRouteManifest.find((candidate) => candidate.id === route.id)

      // `auth` decides whether the bearer token is attached. A manifest that
      // dropped it would send credentials to a route declared to take none.
      expect(entry.auth, route.id).toBe(route.auth)
      expect(entry.body, route.id).toBe(Boolean(route.body))
      expect(entry.query, route.id).toBe(Boolean(route.query))
      expect(entry.method, route.id).toBe(route.method)
      expect(entry.path, route.id).toBe(route.path)
    }
  })

  it('reduces one route the same way the emitter does', () => {
    const [route] = apiRoutes

    expect(toManifestEntry(route)).toEqual({
      id: route.id,
      method: route.method,
      path: route.path,
      auth: route.auth,
      body: Boolean(route.body),
      query: Boolean(route.query),
    })
  })
})
