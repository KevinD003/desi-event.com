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

const { callApi } = await import('./organizer-api.js')

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
