import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, toQueryString } from './api-fetch.js'

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }))
  document.cookie = 'desi_csrf=token-123; path=/'
})

afterEach(() => {
  document.cookie = 'desi_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('the query string', () => {
  it('serialises values and drops null and undefined', () => {
    expect(toQueryString({ revision: 7, missing: null, gone: undefined, q: 'a b' })).toBe(
      '?revision=7&q=a+b',
    )
    expect(toQueryString({})).toBe('')
    expect(toQueryString(undefined)).toBe('')
  })

  it('is appended to the proxied path', async () => {
    await apiFetch('/v1/events/e1/tiers/t1', { method: 'DELETE', query: { revision: 4 } })

    const [url, init] = globalThis.fetch.mock.calls[0]

    expect(url).toBe('/api/v1/events/e1/tiers/t1?revision=4')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(init).not.toHaveProperty('query')
  })
})

describe('the CSRF header', () => {
  it('rides on a DELETE, as on every change', async () => {
    await apiFetch('/v1/events/e1/sessions/s1', { method: 'DELETE', query: { revision: 1 } })

    expect(globalThis.fetch.mock.calls[0][1].headers.get('x-desi-csrf')).toBe('token-123')
  })

  it('stays off a read', async () => {
    await apiFetch('/v1/events/e1/tiers')

    expect(globalThis.fetch.mock.calls[0][1].headers.get('x-desi-csrf')).toBeNull()
  })

  it('marks a JSON body as JSON', async () => {
    await apiFetch('/v1/events/e1', { method: 'PATCH', body: JSON.stringify({ revision: 1 }) })

    expect(globalThis.fetch.mock.calls[0][1].headers.get('content-type')).toBe('application/json')
  })
})

describe('a body where none belongs', () => {
  // The Remove bug: the revision was sent in a DELETE body, which the API does
  // not read, so every removal answered 400.
  it.each(['DELETE', 'GET', 'HEAD'])('is refused on %s before anything is sent', (method) => {
    expect(() =>
      apiFetch('/v1/events/e1/tiers/t1', { method, body: JSON.stringify({ revision: 1 }) }),
    ).toThrow(TypeError)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('names the fix', () => {
    expect(() => apiFetch('/v1/x', { method: 'delete', body: '{}' })).toThrow(/query/)
  })
})
