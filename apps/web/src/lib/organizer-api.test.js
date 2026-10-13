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

const {
  callApi,
  getDeletionPreview,
  getMediaQueue,
  getPlatformEdits,
  getPlatformTraffic,
  getVenueBookings,
  getVenuePayments,
  getWebsiteLinks,
  listOrganizerEvents,
  listPlatformEvents,
} = await import('./organizer-api.js')

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

describe('the full-control reads', () => {
  it('lists every organisation’s events with only the fields the list takes', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'e1' }], pagination: { page: 1, total: 1 } }), {
        status: 200,
      }),
    )

    const result = await listPlatformEvents({
      q: 'garba',
      deleted: 'only',
      sort: 'startsAt:asc',
      status: '',
      page: 2,
      sneaky: 'widen',
    })

    expect(result).toEqual({ events: [{ id: 'e1' }], pagination: { page: 1, total: 1 } })

    const url = new URL(fetch.mock.calls[0][0])

    expect(url.pathname).toBe('/v1/platform/events')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'garba',
      deleted: 'only',
      sort: 'startsAt:asc',
      page: '2',
    })
  })

  it('reads an event’s sittings, its deletion preview and the pictures queue', async () => {
    fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 's1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { outcome: 'REMOVE' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'm1' }], pagination: { total: 1 } }), {
          status: 200,
        }),
      )

    expect(await getPlatformEdits('e 1')).toEqual([{ id: 's1' }])
    expect(await getDeletionPreview('e1')).toEqual({ outcome: 'REMOVE' })
    expect(await getMediaQueue({ status: 'REJECTED', page: 3 })).toEqual({
      pictures: [{ id: 'm1' }],
      pagination: { total: 1 },
    })

    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/v1/events/e%201/platform-edits')
    expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/v1/events/e1/deletion')

    const queue = new URL(fetch.mock.calls[2][0])

    expect(queue.pathname).toBe('/v1/moderation/media')
    expect(Object.fromEntries(queue.searchParams)).toEqual({ status: 'REJECTED', page: '3' })
  })

  it('asks for deleted events by name, and leaves them out otherwise', async () => {
    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    await listOrganizerEvents({ organizationId: 'o1', status: 'DELETED' })
    await listOrganizerEvents({ organizationId: 'o1' })

    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('status')).toBe('DELETED')
    expect(new URL(fetch.mock.calls[1][0]).searchParams.has('status')).toBe(false)
  })
})

describe('paying at the venue (SPEC3 §9.8, SPEC3-XI §11.1)', () => {
  it('reads an event’s payments at the door, a page at a time', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { currency: 'USD' } }), { status: 200 }),
    )

    expect(await getVenuePayments('eventaaaaaaaaaaaaaaaaaaaa', { page: 2 })).toEqual({
      currency: 'USD',
    })
    expect(fetch.mock.calls[0][0]).toMatch(
      /\/v1\/events\/eventaaaaaaaaaaaaaaaaaaaa\/venue-payments\?page=2$/u,
    )
  })

  it('reads the bookings waiting at the door, or one by its reference, sending only what the route takes', async () => {
    fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { bookings: [] } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { bookings: [] } }), { status: 200 }),
      )

    await getVenueBookings('eventaaaaaaaaaaaaaaaaaaaa')
    await getVenueBookings('eventaaaaaaaaaaaaaaaaaaaa', {
      order: 'DE-ABC123',
      page: 1,
      perPage: '',
      organizationId: 'not sent',
    })

    expect(fetch.mock.calls[0][0]).toMatch(/\/venue-bookings$/u)
    expect(fetch.mock.calls[1][0]).toMatch(/\/venue-bookings\?page=1&order=DE-ABC123$/u)
  })

  it('throws a lapsed second factor as the step-up the page can offer', async () => {
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
        { status: 403 },
      ),
    )

    await expect(getVenuePayments('eventaaaaaaaaaaaaaaaaaaaa')).rejects.toMatchObject({
      status: 403,
      code: 'STEP_UP_REQUIRED',
    })
  })
})
