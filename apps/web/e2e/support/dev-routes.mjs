/**
 * Making sure `next dev` routes the pages and the API proxy before a run
 * relies on them.
 *
 * ## What goes wrong
 *
 * `next dev` builds its table of routes from its file watcher. On start the
 * watcher reports the tree in several bursts, and each burst starts the same
 * asynchronous rebuild (`setup-dev-bundler.js`, the `aggregated` handler)
 * without waiting for the one before it: each reads the files the watcher
 * knows at that moment, and each, when it finishes, replaces the dynamic
 * routes and the app paths with what it read. Measured with a probe on this
 * repository, the rebuilds overlap on every start and sometimes finish out of
 * order. The likely cause of what follows is an early one, which read the
 * tree before the watcher had all of it, finishing last: routes it never saw
 * stay missing until the next file change, and nothing changes a file during
 * a run. What was seen: the detail suite's global setup met a 404 from Next's
 * own not-found page (no compile, no call to the API) on its first request to
 * a route, in four of ten starts on 7 October 2026 — three times on
 * `/api/v1/auth/login`, the catch-all proxy, and once on `/sign-in`. It was
 * not reproduced outside a full run.
 *
 * ## What this does
 *
 * Asks for a page and for the proxy, and tells Next's 404 (an HTML page) apart
 * from any answer the API gives (JSON, 401 for nobody signed in). When Next
 * does not know a route, it touches the proxy's route file — its time, never
 * its contents — so the watcher reports one change and one rebuild runs on
 * its own, from the whole tree; then it asks again. A server that still does
 * not know the routes after three tries fails the run here, saying so, rather
 * than as a sign-in that "could not sign in".
 *
 * It changes nothing a test asserts and nothing in the product: the routes it
 * asks for are the ones the run is about to use.
 *
 * @module e2e/support/dev-routes
 */

import { utimes } from 'node:fs/promises'
import path from 'node:path'

/**
 * The proxy's route file: touched, never written, to make the watcher report a
 * change. Found from the working directory, as the detail setup finds its own
 * state directory: Playwright runs from `apps/web`.
 */
const PROXY_ROUTE = path.join(process.cwd(), 'src', 'app', 'api', 'v1', '[...path]', 'route.js')

/** What is asked for: a page, and the proxy (which the API answers 401 when nobody is signed in). */
const PROBES = Object.freeze(['/sign-in', '/api/v1/auth/me'])

/** How many times the table is rebuilt before giving up. */
const ATTEMPTS = 3

/** How long a rebuild is given before asking again. */
const SETTLE_MS = 3_000

/**
 * Whether Next itself answered "no such route": a 404 drawn as its HTML
 * not-found page. The API's own 404 is JSON and is an answer, not a gap.
 *
 * @param {Response} response The answer.
 * @returns {boolean} True when Next did not know the route.
 */
function nextDoesNotKnow(response) {
  return (
    response.status === 404 && (response.headers.get('content-type') ?? '').includes('text/html')
  )
}

/**
 * The probes Next does not route, in order.
 *
 * @param {string} baseURL The web server.
 * @returns {Promise<string[]>} The paths it answered with its own 404.
 */
async function unrouted(baseURL) {
  const missing = []

  for (const probe of PROBES) {
    const response = await fetch(new URL(probe, baseURL), { redirect: 'manual' })

    await response.arrayBuffer()

    if (nextDoesNotKnow(response)) missing.push(probe)
  }

  return missing
}

/**
 * Ask until Next routes every probe, rebuilding its table when it does not.
 *
 * @param {string} baseURL The web server.
 * @returns {Promise<void>} Resolves once every probe is routed.
 */
export async function settleDevRoutes(baseURL) {
  let missing = await unrouted(baseURL)

  for (let attempt = 1; missing.length > 0; attempt += 1) {
    if (attempt > ATTEMPTS) {
      throw new Error(
        `next dev still answers 404 for ${missing.join(' and ')} after ${ATTEMPTS} rebuilds of its routes.`,
      )
    }

    console.warn(
      `[e2e] next dev did not route ${missing.join(' and ')}; rebuilding its routes (${attempt} of ${ATTEMPTS}).`,
    )

    const now = new Date()

    await utimes(PROXY_ROUTE, now, now)
    await new Promise((resolve) => {
      setTimeout(resolve, SETTLE_MS)
    })

    missing = await unrouted(baseURL)
  }
}
