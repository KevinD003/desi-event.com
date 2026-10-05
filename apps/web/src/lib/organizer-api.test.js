/**
 * What `callApi` throws is what every signed-in page reads a refusal from.
 *
 * The properties that matter: the session cookie is forwarded and nothing
 * else of the browser's; a refusal carries the status, the API's code and
 * how long `Retry-After` asked for; and a dead API throws something with no
 * status at all, which the refusal vocabulary reads as "not answering" rather
 * than as a refusal.
 *
 * @module lib/organizer-api.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [{ name: 'desi_session', value: 'opaque' }] }),
}))

const { callApi, getPlatformTraffic, getWebsiteLinks } = await import('./organizer-api.js')

const fetch = vi.fn()

beforeEach(() => {
  fetch.mockReset()
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callApi', () => {
  it('forwards the session cookie and returns the body', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    )

    expect(await callApi('/v1/auth/me')).toEqual({ data: { ok: true } })

    const [url, options] = fetch.mock.calls[0]

    expect(url).toMatch(/\/v1\/auth\/me$/)
    expect(options.headers.cookie).toBe('desi_session=opaque')
    expect(options.cache).toBe('no-store')
  })

  it('throws the status, the code and how long to wait', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down.' } }), {
        status: 429,
        headers: { 'retry-after': '90' },
      }),
    )

    await expect(callApi('/v1/refunds')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Slow down.',
      retryAfterSeconds: 90,
    })
  })

  it('throws a step-up refusal as the code the pages switch on', async () => {
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } }),
        { status: 403 },
      ),
    )

    await expect(callApi('/v1/refunds/x')).rejects.toMatchObject({
      status: 403,
      code: 'STEP_UP_REQUIRED',
      retryAfterSeconds: null,
    })
  })

  it('lets a dead API throw with no status', async () => {
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    const error = await callApi('/v1/auth/me').catch((caught) => caught)

    expect(error.status).toBeUndefined()
  })
})

describe('getWebsiteLinks', () => {
  it('asks for one filter, search and page, and gives the rows and the counters', async () => {
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ eventId: 'e1' }], pagination: { page: 2, total: 21 } }),
        { status: 200 },
      ),
    )

    const result = await getWebsiteLinks({ state: 'on', q: 'garba night', page: 2, perPage: 20 })

    expect(result).toEqual({ links: [{ eventId: 'e1' }], pagination: { page: 2, total: 21 } })
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/v1/moderation/website-links')
    expect(Object.fromEntries(new URL(fetch.mock.calls[0][0]).searchParams)).toEqual({
      state: 'on',
      q: 'garba night',
      page: '2',
      perPage: '20',
    })
  })

  it('leaves the filter to the API’s default when none is named', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    expect(await getWebsiteLinks()).toEqual({ links: [], pagination: null })
    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/moderation\/website-links$/u)
  })
})

describe('getPlatformTraffic', () => {
  it('sends only the fields the platform list takes, and gives the list and the counters', async () => {
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { top: [], events: [] }, pagination: { page: 2, total: 51 } }),
        { status: 200 },
      ),
    )

    const result = await getPlatformTraffic({
      q: 'garba',
      scope: 'all',
      from: '2026-09-06T00:00:00.000Z',
      page: 2,
      perPage: 50,
      organizationId: '',
      sneaky: 'widen',
    })

    expect(result).toEqual({ data: { top: [], events: [] }, pagination: { page: 2, total: 51 } })

    const url = new URL(fetch.mock.calls[0][0])

    expect(url.pathname).toBe('/v1/traffic/events')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'garba',
      scope: 'all',
      from: '2026-09-06T00:00:00.000Z',
      page: '2',
      perPage: '50',
    })
  })

  it('throws the API’s refusal for the page to draw', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'No.' } }), {
        status: 403,
      }),
    )

    const error = await getPlatformTraffic().catch((caught) => caught)

    expect(error.status).toBe(403)
    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/traffic\/events$/u)
  })
})
