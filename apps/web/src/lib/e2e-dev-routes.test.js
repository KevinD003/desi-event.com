/**
 * How `e2e/support/dev-routes.mjs` finds and mends a `next dev` that does not
 * route a page or the API proxy.
 *
 * Three ways of getting it wrong are pinned here: mistaking the API's own
 * answer (JSON, a 401 or even a 404) for Next not knowing the route, which
 * would touch a file on every run; giving up without making the watcher
 * rebuild the routes; and going on for ever, so that a server that never
 * recovers fails as a sign-in that "could not sign in" instead of saying why.
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

const { settleDevRoutes } = await import('../../e2e/support/dev-routes.mjs')

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
  it('touches nothing when both are routed, the API answering for itself', async () => {
    vi.stubGlobal('fetch', serve({ '/sign-in': [PAGE], '/api/v1/auth/me': [API_401] }))

    await settleDevRoutes(BASE)

    expect(fs.utimes).not.toHaveBeenCalled()
  })

  it('takes the API’s own 404, which is JSON, for an answer and not for a missing route', async () => {
    vi.stubGlobal(
      'fetch',
      serve({
        '/sign-in': [PAGE],
        '/api/v1/auth/me': [() => answer(404, 'application/json; charset=utf-8')],
      }),
    )

    await settleDevRoutes(BASE)

    expect(fs.utimes).not.toHaveBeenCalled()
  })

  it('rebuilds the routes by touching the proxy’s file when Next does not know it, then asks again', async () => {
    const fetch = serve({ '/sign-in': [PAGE], '/api/v1/auth/me': [NEXT_404, API_401] })

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
    vi.stubGlobal('fetch', serve({ '/sign-in': [NEXT_404], '/api/v1/auth/me': [API_401] }))

    const settled = settleDevRoutes(BASE)
    const refused = expect(settled).rejects.toThrow(
      'next dev still answers 404 for /sign-in after 3 rebuilds of its routes.',
    )

    await vi.runAllTimersAsync()
    await refused

    expect(fs.utimes).toHaveBeenCalledTimes(3)
  })
})
