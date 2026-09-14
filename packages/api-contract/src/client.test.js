import { describe, expect, it, vi } from 'vitest'

import { ApiClientError, ApiContractError, isApiClientError } from './errors.js'
import { createApiClient, serialiseQuery, splitInput } from './client.js'
import { routeById } from './routes.js'

/**
 * Build a fetch stub that records calls and replays canned responses.
 *
 * @param {Array<{status?: number, body?: unknown, contentType?: string, raw?: string}>} responses Responses, consumed in order; the last one repeats.
 * @returns {{fetch: Function, calls: Array<{url: string, init: object}>}} The stub and its call log.
 */
function stubFetch(responses = [{ status: 200, body: { ok: true } }]) {
  const calls = []
  let index = 0

  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const spec = responses[Math.min(index, responses.length - 1)]
    index += 1

    const status = spec.status ?? 200
    const contentType = spec.contentType ?? 'application/json'
    const payload = spec.raw ?? (spec.body === undefined ? '' : JSON.stringify(spec.body))

    return new Response(status === 204 ? null : payload, {
      status,
      headers: payload || status !== 204 ? { 'content-type': contentType } : {},
    })
  }

  return { fetch: fetchImpl, calls }
}

describe('serialiseQuery', () => {
  it('returns an empty string for nothing to send', () => {
    expect(serialiseQuery()).toBe('')
    expect(serialiseQuery({})).toBe('')
  })

  it('drops undefined and null rather than sending their string forms', () => {
    expect(serialiseQuery({ a: undefined, b: null, c: 1 })).toBe('c=1')
  })

  it('keeps an explicit empty string and a zero', () => {
    expect(serialiseQuery({ q: '', page: 0 })).toBe('q=&page=0')
  })

  it('renders booleans as true/false', () => {
    expect(serialiseQuery({ isOnline: false })).toBe('isOnline=false')
    expect(serialiseQuery({ isOnline: true })).toBe('isOnline=true')
  })

  it('repeats the key for an array and skips holes in it', () => {
    expect(serialiseQuery({ tag: ['a', null, 'b'] })).toBe('tag=a&tag=b')
  })

  it('renders a Date as an ISO-8601 instant', () => {
    expect(serialiseQuery({ startsAfter: new Date('2026-03-14T10:00:00.000Z') })).toBe(
      'startsAfter=2026-03-14T10%3A00%3A00.000Z',
    )
  })

  it('percent-encodes keys and values', () => {
    expect(serialiseQuery({ 'a b': 'c&d=e' })).toBe('a+b=c%26d%3De')
  })

  it('preserves insertion order so URLs are stable and cacheable', () => {
    expect(serialiseQuery({ z: 1, a: 2 })).toBe('z=1&a=2')
  })
})

describe('splitInput', () => {
  it('lifts path parameters out of a flat argument', () => {
    const split = splitInput(routeById('events.update'), { id: 'abcdefgh', title: 'New' })

    expect(split.params).toEqual({ id: 'abcdefgh' })
    expect(split.body).toEqual({ title: 'New', id: 'abcdefgh' })
    expect(split.query).toEqual({})
  })

  it('treats the leftovers of a bodyless route as the query', () => {
    const split = splitInput(routeById('events.list'), { page: 2, city: 'Pune' })

    expect(split.query).toEqual({ page: 2, city: 'Pune' })
    expect(split.body).toBeUndefined()
  })

  it('accepts the structured form', () => {
    const split = splitInput(routeById('ticketTypes.create'), {
      params: { eventId: 'abcdefgh' },
      body: { name: 'General' },
    })

    expect(split.params).toEqual({ eventId: 'abcdefgh' })
    expect(split.body).toEqual({ name: 'General', eventId: 'abcdefgh' })
  })

  it('does not mistake a body field named "query" for the structured form', () => {
    const split = splitInput(routeById('events.list'), { query: 'garba' })

    expect(split.query).toEqual({ query: 'garba' })
    expect(split.params).toEqual({})
  })

  it('folds the path id into the body so schemas that require it still validate', () => {
    const split = splitInput(routeById('waitlist.join'), {
      eventId: 'abcdefgh',
      email: 'buyer@example.com',
    })

    expect(split.body).toEqual({ email: 'buyer@example.com', eventId: 'abcdefgh' })
  })

  it('lets the path parameter win over a conflicting body field', () => {
    const split = splitInput(routeById('waitlist.join'), {
      params: { eventId: 'pathevent' },
      body: { eventId: 'bodyevent', email: 'buyer@example.com' },
    })

    expect(split.body.eventId).toBe('pathevent')
  })

  it('handles no argument at all', () => {
    expect(splitInput(routeById('auth.me'))).toEqual({ params: {}, query: {}, body: undefined })
  })

  it('rejects stray fields on a route that has nowhere to put them', () => {
    expect(() => splitInput(routeById('holds.release'), { id: 'abcdefgh', extra: 1 })).toThrow(
      ApiContractError,
    )
    expect(() => splitInput(routeById('holds.release'), { id: 'abcdefgh', extra: 1 })).toThrow(
      /takes no query or body/,
    )
  })

  it('rejects a non-object argument', () => {
    expect(() => splitInput(routeById('events.list'), ['nope'])).toThrow(/expects an object/)
  })
})

describe('createApiClient', () => {
  it('requires a baseUrl', () => {
    expect(() => createApiClient({ fetch: stubFetch().fetch })).toThrow(ApiContractError)
    expect(() => createApiClient({ baseUrl: 42, fetch: stubFetch().fetch })).toThrow(/baseUrl/)
  })

  it('requires a fetch implementation', () => {
    expect(() => createApiClient({ baseUrl: 'https://api.test', fetch: null })).toThrow(/fetch/)
  })

  it('exposes one method per route, nested by namespace', () => {
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stubFetch().fetch })

    expect(typeof client.events.list).toBe('function')
    expect(typeof client.ticketTypes.listForEvent).toBe('function')
    expect(typeof client.tickets.checkIn).toBe('function')
    expect(typeof client.health.get).toBe('function')
    expect(client.events.list.name).toBe('events.list')
  })

  it('builds the URL from path parameters', async () => {
    const stub = stubFetch([{ body: { data: {} } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })

    await client.events.get({ slug: 'garba-night' })

    expect(stub.calls[0].url).toBe('https://api.test/v1/events/garba-night')
    expect(stub.calls[0].init.method).toBe('GET')
  })

  it('appends a serialised query string', async () => {
    const stub = stubFetch([{ body: { data: [] } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })

    await client.events.list({ page: 2, perPage: 50, city: 'Ahmedabad', isOnline: false })

    expect(stub.calls[0].url).toBe(
      'https://api.test/v1/events?page=2&perPage=50&city=Ahmedabad&isOnline=false',
    )
  })

  it('omits the "?" when the query is empty', async () => {
    const stub = stubFetch([{ body: { data: [] } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })

    await client.events.list({})

    expect(stub.calls[0].url).toBe('https://api.test/v1/events')
  })

  it('sends a JSON body with the right content type', async () => {
    const stub = stubFetch([{ status: 201, body: { token: 't' } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })

    await client.auth.register({ email: 'a@b.com', password: 'hunter22', displayName: 'A' })

    const { init } = stub.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.com',
      password: 'hunter22',
      displayName: 'A',
    })
  })

  it('sends no body on a DELETE', async () => {
    const stub = stubFetch([{ body: { ok: true } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })

    await client.holds.release({ id: 'abcdefgh' })

    expect(stub.calls[0].init.method).toBe('DELETE')
    expect(stub.calls[0].init.body).toBeUndefined()
  })

  it('attaches the bearer header when a token is configured', async () => {
    const stub = stubFetch([{ body: { data: {} } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch, token: 'jwt-1' })

    await client.auth.me()

    expect(stub.calls[0].init.headers.authorization).toBe('Bearer jwt-1')
  })

  it('sends no bearer header when there is no token', async () => {
    const stub = stubFetch([{ body: { data: {} } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })

    await client.auth.me()

    expect(stub.calls[0].init.headers.authorization).toBeUndefined()
  })

  it('never leaks the token to a route that takes no credentials', async () => {
    const stub = stubFetch([{ body: { status: 'ok' } }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch, token: 'jwt-1' })

    await client.health.get()

    expect(stub.calls[0].init.headers.authorization).toBeUndefined()
  })

  it('resolves a token getter, including an async one', async () => {
    const stub = stubFetch([{ body: {} }, { body: {} }])
    const sync = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch, token: () => 'sync-token' })
    const async = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stub.fetch,
      token: async () => 'async-token',
    })

    await sync.auth.me()
    await async.auth.me()

    expect(stub.calls[0].init.headers.authorization).toBe('Bearer sync-token')
    expect(stub.calls[1].init.headers.authorization).toBe('Bearer async-token')
  })

  it('lets a call override the token, and null suppress it', async () => {
    const stub = stubFetch([{ body: {} }, { body: {} }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch, token: 'jwt-1' })

    await client.auth.me(undefined, { token: 'jwt-2' })
    await client.auth.me(undefined, { token: null })

    expect(stub.calls[0].init.headers.authorization).toBe('Bearer jwt-2')
    expect(stub.calls[1].init.headers.authorization).toBeUndefined()
  })

  it('derives a client with a different token via withToken', async () => {
    const stub = stubFetch([{ body: {} }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch, token: 'a' })

    await client.withToken('b').auth.me()

    expect(stub.calls[0].init.headers.authorization).toBe('Bearer b')
  })

  it('merges client-level and per-call headers, with the call winning', async () => {
    const stub = stubFetch([{ body: {} }])
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stub.fetch,
      headers: { 'x-tenant': 'in', 'accept-language': 'en-IN' },
    })

    await client.health.get(undefined, { headers: { 'accept-language': 'hi-IN' } })

    expect(stub.calls[0].init.headers).toMatchObject({
      accept: 'application/json',
      'x-tenant': 'in',
      'accept-language': 'hi-IN',
    })
  })

  it('forwards an abort signal', async () => {
    const stub = stubFetch([{ body: {} }])
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stub.fetch })
    const controller = new AbortController()

    await client.health.get(undefined, { signal: controller.signal })

    expect(stub.calls[0].init.signal).toBe(controller.signal)
  })

  it('parses and returns a JSON success body', async () => {
    const payload = { data: { id: 'abcdefgh' } }
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stubFetch([{ body: payload }]).fetch })

    await expect(client.events.get({ slug: 'x' })).resolves.toEqual(payload)
  })

  it('returns null for a 204 with no body', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ status: 204 }]).fetch,
    })

    await expect(client.holds.release({ id: 'abcdefgh' })).resolves.toBeNull()
  })

  it('returns text when the server does not send JSON', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ raw: 'pong', contentType: 'text/plain' }]).fetch,
    })

    await expect(client.health.get()).resolves.toBe('pong')
  })

  it('hands back a malformed JSON body verbatim rather than masking it', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ raw: '{not json', contentType: 'application/json' }]).fetch,
    })

    await expect(client.health.get()).resolves.toBe('{not json')
  })
})

describe('error mapping', () => {
  it('throws ApiClientError carrying status, body and code', async () => {
    const body = { error: { code: 'NOT_FOUND', message: 'No such event', statusCode: 404 } }
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ status: 404, body }]).fetch,
    })

    const error = await client.events.get({ slug: 'missing' }).catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(isApiClientError(error)).toBe(true)
    expect(error.status).toBe(404)
    expect(error.statusCode).toBe(404)
    expect(error.code).toBe('NOT_FOUND')
    expect(error.body).toEqual(body)
    expect(error.routeId).toBe('events.get')
    expect(error.method).toBe('GET')
    expect(error.url).toBe('https://api.test/v1/events/missing')
    expect(error.message).toContain('No such event')
    expect(error.isNetworkError).toBe(false)
  })

  it('carries validation issues through untouched', async () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        issues: [{ path: 'email', code: 'invalid_format', message: 'Invalid email' }],
      },
    }

    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ status: 400, body }]).fetch,
    })

    const error = await client.auth.login({ email: 'nope', password: 'x' }).catch((caught) => caught)

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.body.error.issues).toHaveLength(1)
  })

  it('falls back to an HTTP_<status> code when the body is not an envelope', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ status: 502, raw: 'bad gateway', contentType: 'text/plain' }]).fetch,
    })

    const error = await client.health.get().catch((caught) => caught)

    expect(error.code).toBe('HTTP_502')
    expect(error.body).toBe('bad gateway')
    expect(error.message).toBe('GET /health failed with 502')
  })

  it('reports a transport failure as a network error with status 0', async () => {
    const boom = new Error('ECONNREFUSED')
    const fetchImpl = vi.fn().mockRejectedValue(boom)
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: fetchImpl })

    const error = await client.health.get().catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.status).toBe(0)
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.isNetworkError).toBe(true)
    expect(error.cause).toBe(boom)
  })

  it('does not swallow a missing path parameter as an HTTP error', async () => {
    const fetchImpl = vi.fn()
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: fetchImpl })

    await expect(client.events.get({})).rejects.toBeInstanceOf(ApiContractError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an unknown route id passed to request()', async () => {
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: stubFetch().fetch })

    await expect(client.request('nope.nope')).rejects.toThrow(/Unknown route id/)
  })

  it('treats a 2xx other than 200 as success', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: stubFetch([{ status: 201, body: { data: { id: 'abcdefgh' } } }]).fetch,
    })

    await expect(client.holds.create({ ticketTypeId: 'abcdefgh', quantity: 2 })).resolves.toEqual({
      data: { id: 'abcdefgh' },
    })
  })
})
