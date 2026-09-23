/**
 * The order reads ask the API the right question and pass its refusals on.
 *
 * Run against the real `callApi` with only `fetch` and the cookie jar faked,
 * so what is pinned is the request that actually leaves: the path, the paging
 * query, a reference that cannot step out of `/v1/orders/` (and a malformed
 * one that is never sent at all), the forwarded session — and the `status` and
 * `code` a page reads a refusal from.
 *
 * @module lib/account-api.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [{ name: 'desi_session', value: 'opaque' }] }),
}))

const { getMyOrder, getMyOrders } = await import('./account-api.js')

const fetch = vi.fn()

/**
 * A JSON response.
 *
 * @param {object} body The body.
 * @param {number} [status] The HTTP status.
 * @returns {Response} The response.
 */
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

/**
 * The URL of the one request made, without the configured origin.
 *
 * @returns {URL} The request URL.
 */
function requested() {
  expect(fetch).toHaveBeenCalledTimes(1)

  return new URL(fetch.mock.calls[0][0])
}

beforeEach(() => {
  fetch.mockReset()
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getMyOrders', () => {
  it('asks for the first page of twenty by default', async () => {
    fetch.mockResolvedValueOnce(reply({ data: [], pagination: null }))

    await getMyOrders()

    const url = requested()

    expect(url.pathname).toBe('/v1/orders')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('perPage')).toBe('20')
  })

  it('asks for the page it was given', async () => {
    fetch.mockResolvedValueOnce(reply({ data: [], pagination: null }))

    await getMyOrders({ page: 3, perPage: 10 })

    const url = requested()

    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('perPage')).toBe('10')
  })

  it('forwards the session cookie', async () => {
    fetch.mockResolvedValueOnce(reply({ data: [], pagination: null }))

    await getMyOrders()

    expect(fetch.mock.calls[0][1].headers.cookie).toBe('desi_session=opaque')
  })

  it('returns the orders and the counters under the names the pages read', async () => {
    const pagination = {
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    }

    fetch.mockResolvedValueOnce(reply({ data: [{ reference: 'DE-AAAA' }], pagination }))

    expect(await getMyOrders()).toEqual({ orders: [{ reference: 'DE-AAAA' }], pagination })
  })

  it('throws the status and code of a refusal rather than an empty list', async () => {
    fetch.mockResolvedValueOnce(
      reply({ error: { code: 'MFA_ENROLMENT_REQUIRED', message: 'Enrol one.' } }, 403),
    )

    await expect(getMyOrders()).rejects.toMatchObject({
      status: 403,
      code: 'MFA_ENROLMENT_REQUIRED',
    })
  })
})

describe('getMyOrder', () => {
  it('reads one order by its reference', async () => {
    fetch.mockResolvedValueOnce(reply({ data: { reference: 'DE-8F3K2Q' } }))

    expect(await getMyOrder('DE-8F3K2Q')).toEqual({ reference: 'DE-8F3K2Q' })
    expect(requested().pathname).toBe('/v1/orders/DE-8F3K2Q')
  })

  it('reads a lower-case reference, which the API upper-cases', async () => {
    fetch.mockResolvedValueOnce(reply({ data: { reference: 'DE-8F3K2Q' } }))

    await getMyOrder('de-8f3k2q')

    expect(requested().pathname).toBe('/v1/orders/de-8f3k2q')
  })

  // `.` and `..` survive `encodeURIComponent` and are resolved by the URL
  // parser: `..` would ask for `/v1/`, and `.` for `/v1/orders/`, the list.
  it.each([['.'], ['..'], ['../tickets?x=1'], ['DE/8F3K'], ['DE 8F3K'], [''], ['DE']])(
    'refuses %p as malformed without sending a request',
    async (reference) => {
      await expect(getMyOrder(reference)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('never asks for a path outside the one order', async () => {
    fetch.mockResolvedValue(reply({ data: {} }))

    for (const reference of ['.', '..', '%2e%2e', 'DE-8F3K2Q']) {
      await getMyOrder(reference).catch(() => {})
    }

    for (const [url] of fetch.mock.calls) {
      expect(new URL(url).pathname).toMatch(/^\/v1\/orders\/[A-Za-z0-9-]+$/)
    }
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws a 404 with its code, for the page to word', async () => {
    fetch.mockResolvedValueOnce(
      reply({ error: { code: 'NOT_FOUND', message: 'No such order.' } }, 404),
    )

    await expect(getMyOrder('DE-NOPE')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})
