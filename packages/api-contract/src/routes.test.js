import { describe, expect, it } from 'vitest'

import { ApiContractError } from './errors.js'
import {
  API_ERRORS,
  API_TAGS,
  AUTH_MODES,
  HTTP_METHODS,
  apiRoutes,
  findRoute,
  routeById,
  routeIds,
  routeKey,
  routeParamNames,
  routesByTag,
} from './routes.js'

/** Every route id the rest of the monorepo is entitled to call. */
const REQUIRED_IDS = [
  'health.get',
  'auth.register',
  'auth.login',
  'auth.me',
  'events.list',
  'events.get',
  'events.create',
  'events.update',
  'events.publish',
  'ticketTypes.listForEvent',
  'ticketTypes.create',
  'holds.create',
  'holds.release',
  'orders.create',
  'orders.get',
  'orders.listMine',
  'tickets.checkIn',
  'waitlist.join',
]

describe('apiRoutes', () => {
  it('covers every route the contract promises', () => {
    for (const id of REQUIRED_IDS) {
      expect(routeIds, `missing route ${id}`).toContain(id)
    }
  })

  it('places each required route at the agreed method and path', () => {
    const expected = {
      'health.get': 'GET /health',
      'auth.register': 'POST /v1/auth/register',
      'auth.login': 'POST /v1/auth/login',
      'auth.me': 'GET /v1/auth/me',
      'events.list': 'GET /v1/events',
      'events.get': 'GET /v1/events/:slug',
      'events.create': 'POST /v1/events',
      'events.update': 'PATCH /v1/events/:id',
      'events.publish': 'POST /v1/events/:id/publish',
      'ticketTypes.listForEvent': 'GET /v1/events/:eventId/ticket-types',
      'ticketTypes.create': 'POST /v1/events/:eventId/ticket-types',
      'holds.create': 'POST /v1/holds',
      'holds.release': 'DELETE /v1/holds/:id',
      'orders.create': 'POST /v1/orders',
      'orders.get': 'GET /v1/orders/:reference',
      'orders.listMine': 'GET /v1/orders',
      'tickets.checkIn': 'POST /v1/tickets/check-in',
      'waitlist.join': 'POST /v1/events/:eventId/waitlist',
    }

    for (const [id, key] of Object.entries(expected)) {
      expect(routeKey(routeById(id)), id).toBe(key)
    }
  })

  it('never claims one method and path twice', () => {
    const keys = apiRoutes.map(routeKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never reuses a route id', () => {
    expect(new Set(routeIds).size).toBe(routeIds.length)
  })

  it('uses only supported methods and auth modes', () => {
    for (const route of apiRoutes) {
      expect(HTTP_METHODS).toContain(route.method)
      expect(AUTH_MODES).toContain(route.auth)
    }
  })

  it('tags every route with a tag the document declares', () => {
    const known = new Set(API_TAGS.map((tag) => tag.name))

    for (const route of apiRoutes) {
      expect(route.tags.length).toBeGreaterThan(0)
      for (const tag of route.tags) expect(known, route.id).toContain(tag)
    }
  })

  it('declares a params schema exactly when the path has parameters', () => {
    for (const route of apiRoutes) {
      const hasParams = routeParamNames(route).length > 0
      expect(Boolean(route.params), route.id).toBe(hasParams)
    }
  })

  it('never puts a body on a GET or DELETE', () => {
    for (const route of apiRoutes.filter((r) => r.method === 'GET' || r.method === 'DELETE')) {
      expect(route.body, route.id).toBeNull()
    }
  })

  it('documents 401 on every bearer-only route', () => {
    for (const route of apiRoutes.filter((r) => r.auth === 'bearer')) {
      const statuses = route.errors.map((error) => error.status)
      expect(statuses, route.id).toContain(401)
    }
  })

  it('never documents 401 on a route that takes no credentials', () => {
    // `auth: 'none'` means "no session is required", not "no secret is
    // presented". These four take one in the body — a password, or a single-use
    // link — so 401 is the honest answer when it does not check out. Every other
    // anonymous route is a read, and a read that can 401 is a read somebody has
    // put a credential check into by mistake.
    const carriesCredentialInBody = new Set([
      'auth.login',
      'auth.verifyEmail',
      'auth.resetPassword',
    ])

    for (const route of apiRoutes.filter((r) => r.auth === 'none')) {
      if (carriesCredentialInBody.has(route.id)) continue

      const statuses = route.errors.map((error) => error.status)
      expect(statuses, route.id).not.toContain(401)
    }
  })

  it('returns 201 from the routes that create a resource', () => {
    const created = [
      'auth.register',
      'events.create',
      'ticketTypes.create',
      'holds.create',
      'orders.create',
      'waitlist.join',
    ]

    for (const id of created) {
      expect(routeById(id).successStatus, id).toBe(201)
    }
  })

  it('freezes descriptors so a consumer cannot mutate the shared table', () => {
    const route = routeById('events.list')
    expect(Object.isFrozen(route)).toBe(true)
    expect(Object.isFrozen(apiRoutes)).toBe(true)
    expect(() => {
      route.path = '/hacked'
    }).toThrow(TypeError)
  })

  it('never documents the same error status twice on one route', () => {
    for (const route of apiRoutes) {
      const statuses = route.errors.map((error) => error.status)
      expect(new Set(statuses).size, route.id).toBe(statuses.length)
    }
  })

  it('draws every documented error from the shared catalogue', () => {
    const known = new Set(Object.values(API_ERRORS))

    for (const route of apiRoutes) {
      for (const error of route.errors) expect(known, route.id).toContain(error)
    }
  })
})

describe('routeById', () => {
  it('returns the descriptor', () => {
    expect(routeById('events.list').method).toBe('GET')
  })

  it('throws for an unknown id and names the alternatives', () => {
    expect(() => routeById('events.nope')).toThrow(ApiContractError)

    try {
      routeById('events.nope')
    } catch (error) {
      expect(error.code).toBe('UNKNOWN_ROUTE')
      expect(error.details.known).toContain('events.list')
    }
  })
})

describe('findRoute', () => {
  it('returns undefined instead of throwing', () => {
    expect(findRoute('events.nope')).toBeUndefined()
    expect(findRoute('events.get')?.id).toBe('events.get')
  })
})

describe('routesByTag', () => {
  it('collects every route tagged `events`, and nothing else', () => {
    // The set, not a hand-kept list in declaration order. An ordered literal
    // has to be edited every time a route is inserted anywhere in the table,
    // which makes it a chore rather than a check — and a chore gets updated
    // reflexively, which is how a check stops checking.
    const tagged = apiRoutes.filter((route) => route.tags.includes('events')).map((r) => r.id)

    expect(routesByTag('events').map((route) => route.id)).toEqual(tagged)
    expect(tagged.length).toBeGreaterThan(15)
    expect(tagged).toContain('events.list')
    expect(tagged).toContain('events.publish')
    expect(tagged).toContain('moderation.decide')
  })

  it('preserves declaration order', () => {
    // What `routesByTag` is actually for: a stable order a document can render.
    const positions = routesByTag('events').map((route) => apiRoutes.indexOf(route))

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('returns an empty array for an unused tag', () => {
    expect(routesByTag('nope')).toEqual([])
  })
})
