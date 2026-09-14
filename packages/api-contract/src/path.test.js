import { describe, expect, it } from 'vitest'

import { ApiContractError } from './errors.js'
import { buildPath, joinUrl, pathParamNames, routeShape, toOpenApiPath } from './path.js'

describe('pathParamNames', () => {
  it('lists parameters in order of appearance', () => {
    expect(pathParamNames('/v1/events/:eventId/ticket-types/:id')).toEqual(['eventId', 'id'])
  })

  it('returns an empty list for a static path', () => {
    expect(pathParamNames('/v1/tickets/check-in')).toEqual([])
  })

  it('does not treat a colon inside a segment as a parameter', () => {
    expect(pathParamNames('/v1/odd/a:b')).toEqual([])
  })
})

describe('toOpenApiPath', () => {
  it('converts colon syntax to braces', () => {
    expect(toOpenApiPath('/v1/events/:slug')).toBe('/v1/events/{slug}')
  })

  it('converts every parameter in a multi-parameter path', () => {
    expect(toOpenApiPath('/v1/events/:eventId/waitlist')).toBe('/v1/events/{eventId}/waitlist')
  })

  it('leaves a static path alone', () => {
    expect(toOpenApiPath('/health')).toBe('/health')
  })

  it('normalises a trailing slash away', () => {
    expect(toOpenApiPath('/v1/events/')).toBe('/v1/events')
  })
})

describe('buildPath', () => {
  it('substitutes values', () => {
    expect(buildPath('/v1/events/:slug', { slug: 'garba-night-2026' })).toBe('/v1/events/garba-night-2026')
  })

  it('percent-encodes so a value cannot inject a path segment', () => {
    expect(buildPath('/v1/events/:slug', { slug: 'a/../admin' })).toBe('/v1/events/a%2F..%2Fadmin')
  })

  it('stringifies non-string values', () => {
    expect(buildPath('/v1/holds/:id', { id: 42 })).toBe('/v1/holds/42')
  })

  it('throws a contract error when a parameter is missing', () => {
    expect(() => buildPath('/v1/events/:slug', {})).toThrow(ApiContractError)
    expect(() => buildPath('/v1/events/:slug', {})).toThrow(/Missing path parameter "slug"/)
  })

  it('treats an empty string as missing rather than building //', () => {
    expect(() => buildPath('/v1/events/:slug', { slug: '' })).toThrow(/Missing path parameter/)
  })

  it('rejects null and undefined explicitly', () => {
    expect(() => buildPath('/v1/holds/:id', { id: null })).toThrow(ApiContractError)
    expect(() => buildPath('/v1/holds/:id', { id: undefined })).toThrow(ApiContractError)
  })

  it('carries the offending parameter in details', () => {
    try {
      buildPath('/v1/events/:eventId/waitlist', {})
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.code).toBe('MISSING_PATH_PARAM')
      expect(error.details).toEqual({ path: '/v1/events/:eventId/waitlist', param: 'eventId' })
    }
  })
})

describe('joinUrl', () => {
  it('joins without doubling the slash', () => {
    expect(joinUrl('https://api.test/', '/v1/events')).toBe('https://api.test/v1/events')
  })

  it('joins when the base has no trailing slash', () => {
    expect(joinUrl('https://api.test', '/v1/events')).toBe('https://api.test/v1/events')
  })

  it('collapses several trailing slashes', () => {
    expect(joinUrl('https://api.test///', '/health')).toBe('https://api.test/health')
  })

  it('keeps a base path prefix', () => {
    expect(joinUrl('https://api.test/gateway', '/v1/events')).toBe('https://api.test/gateway/v1/events')
  })
})

describe('routeShape', () => {
  it('blanks parameter names so a router-level clash is visible', () => {
    expect(routeShape('/v1/events/:slug')).toBe('/v1/events/{}')
    expect(routeShape('/v1/events/:id')).toBe('/v1/events/{}')
  })

  it('keeps static segments that follow a parameter', () => {
    expect(routeShape('/v1/events/:id/publish')).toBe('/v1/events/{}/publish')
    expect(routeShape('/v1/events/:eventId/waitlist')).toBe('/v1/events/{}/waitlist')
  })

  it('leaves a fully static path alone', () => {
    expect(routeShape('/v1/tickets/check-in')).toBe('/v1/tickets/check-in')
  })
})
