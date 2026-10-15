/**
 * How `e2e/support/dev-routes.mjs` finds and mends a `next dev` that does not
 * route a page, the API proxy or a dynamic page.
 *
 * Four ways of getting it wrong are pinned here: mistaking the API's own
 * answer (JSON, a 401 or even a 404) or a page's redirect for Next not knowing
 * the route, which would touch a file on every run; asking only for the routes
 * a stale table happened to keep, as this module once did; giving up without
 * making the watcher rebuild the routes; and going on for ever, so that a
 * server that never recovers fails as a sign-in that "could not sign in"
 * instead of saying why.
 *
 * `fetch` and `utimes` are replaced, so nothing is requested and no file is
 * touched.
 *
 * @module lib/e2e-dev-routes.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fs = vi.hoisted(() => ({ utimes: vi.fn(async () => {}) }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()

  return { ...actual, default: { ...actual, utimes: fs.utimes }, utimes: fs.utimes }
})

const { PROBES, settleDevRoutes } = await import('../../e2e/support/dev-routes.mjs')

const BASE = 'http://127.0.0.1:3440'

/**
 * An answer as `fetch` gives one.
 *
 * @param {number} status The status.
 * @param {string} type The content type.
 * @returns {Response} The response.
 */
function answer(status, type) {
  return new Response(type.includes('json') ? '{}' : '<html></html>', {
    status,
    headers: { 'content-type': type },
  })
}

/** Next's own not-found page. */
const NEXT_404 = () => answer(404, 'text/html; charset=utf-8')

/** The page, drawn. */
const PAGE = () => answer(200, 'text/html; charset=utf-8')

/** The API, through the proxy, for nobody signed in. */
const API_401 = () => answer(401, 'application/json; charset=utf-8')

/** A signed-in area's page, for a visitor who is not signed in. */
const TO_SIGN_IN = () => answer(307, 'text/html; charset=utf-8')

/** The dynamic page asked for, two segments deep in the organiser area. */
const MAPS = '/organizer/venues/route-check/maps'

/**
 * Drive `fetch` from a table: each path's answers in turn, the last repeated.
 *
 * @param {Record<string, Array<function(): Response>>} table Answers by path.
 * @returns {object} The mock.
 */
function serve(table) {
  const seen = {}

  return vi.fn(async (url) => {
    const { pathname } = new URL(url)
    const answers = table[pathname]
    const index = Math.min(seen[pathname] ?? 0, answers.length - 1)

    seen[pathname] = (seen[pathname] ?? 0) + 1

    return answers[index]()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  fs.utimes.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('making sure next dev routes the pages and the proxy', () => {
  it('asks for a page, the proxy and a dynamic page, the three kinds a stale table lost', () => {
    expect(PROBES).toEqual(['/sign-in', '/api/v1/auth/me', MAPS])
  })

  it('touches nothing when all are routed, the API and the page answering for themselves', async () => {
    vi.stubGlobal(
      'fetch',
      serve({ '/sign-in': [PAGE], '/api/v1/auth/me': [API_401], [MAPS]: [TO_SIGN_IN] }),
    )

    await settleDevRoutes(BASE)

    expect(fs.utimes).not.toHaveBeenCalled()
  })

  it('takes the API’s own 404, which is JSON, for an answer and not for a missing route', async () => {
    vi.stubGlobal(
      'fetch',
      serve({
        '/sign-in': [PAGE],
        '/api/v1/auth/me': [() => answer(404, 'application/json; charset=utf-8')],
        [MAPS]: [TO_SIGN_IN],
      }),
    )

    await settleDevRoutes(BASE)

    expect(fs.utimes).not.toHaveBeenCalled()
  })

  it('rebuilds the routes by touching the proxy’s file when Next does not know it, then asks again', async () => {
    const fetch = serve({
      '/sign-in': [PAGE],
      '/api/v1/auth/me': [NEXT_404, API_401],
      [MAPS]: [TO_SIGN_IN],
    })

    vi.stubGlobal('fetch', fetch)

    const settled = settleDevRoutes(BASE)

    await vi.runAllTimersAsync()
    await settled

    expect(fs.utimes).toHaveBeenCalledTimes(1)
    expect(fs.utimes.mock.calls[0][0]).toMatch(/src\/app\/api\/v1\/\[\.\.\.path\]\/route\.js$/u)
    // Its time, never its contents: both times are a moment, nothing else.
    expect(fs.utimes.mock.calls[0][1]).toBeInstanceOf(Date)
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/me')),
    ).toHaveLength(2)
  })

  it('says which route is still missing after three rebuilds, rather than going on', async () => {
    vi.stubGlobal(
      'fetch',
      serve({ '/sign-in': [NEXT_404], '/api/v1/auth/me': [API_401], [MAPS]: [TO_SIGN_IN] }),
    )

    const settled = settleDevRoutes(BASE)
    const refused = expect(settled).rejects.toThrow(
      'next dev still answers 404 for /sign-in after 3 rebuilds of its routes.',
    )

    await vi.runAllTimersAsync()
    await refused

    expect(fs.utimes).toHaveBeenCalledTimes(3)
  })

  it('rebuilds when only the dynamic page is missing, the proxy and the sign-in page still routed', async () => {
    // The table of 70 the review found three times in 24 starts: a check of
    // the proxy and /sign-in alone passed it, and the seat picker met a 404.
    const fetch = serve({
      '/sign-in': [PAGE],
      '/api/v1/auth/me': [API_401],
      [MAPS]: [NEXT_404, TO_SIGN_IN],
    })

    vi.stubGlobal('fetch', fetch)

    const settled = settleDevRoutes(BASE)

    await vi.runAllTimersAsync()
    await settled

    expect(fs.utimes).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith(MAPS))).toHaveLength(2)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`did not route ${MAPS};`))
  })

  it('asks for the organiser page without following its redirect, so a routed page is never read as missing', async () => {
    const fetch = serve({ '/sign-in': [PAGE], '/api/v1/auth/me': [API_401], [MAPS]: [TO_SIGN_IN] })

    vi.stubGlobal('fetch', fetch)

    await settleDevRoutes(BASE)

    for (const [, init] of fetch.mock.calls) expect(init).toEqual({ redirect: 'manual' })
  })
})
