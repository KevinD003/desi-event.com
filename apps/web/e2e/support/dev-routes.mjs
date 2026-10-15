/**
 * Proving that `next dev` routes the pages and the API proxy before a run
 * relies on them.
 *
 * ## The fault, in Next 16.3.8
 *
 * `next dev` builds its table of routes from a file watcher
 * (`next/dist/server/lib/router-utils/setup-dev-bundler.js`). The watcher
 * starts from time zero with a five-millisecond quiet period, so on start it
 * reports `src/app` in several bursts, and each burst ran the same
 * asynchronous rebuild (the `aggregated` handler) at once, with nothing making
 * it wait for the one before. Each rebuild read the files the watcher knew when
 * it began and, when it finished, replaced the server's app paths and dynamic
 * routes with what it had read. The last to finish won. When an early rebuild,
 * which had seen part of the tree, finished after a later one, its partial
 * table stood until some watched file changed — and nothing changes a file
 * during a run.
 *
 * This was proved, not guessed. A read-only probe logging every rebuild and
 * every write of the table, over 24 starts under CPU and disk load, ended with
 * a stale table six times (Stage E review, area REL): once a table of 20 routes
 * written after one of 73, leaving 53 routes — the proxy among them — answering
 * Next's HTML 404 until the server was stopped; three times a table of 70, the
 * proxy and `/sign-in` still routed but `/events/[slug]/seats/[sessionId]` and
 * `/organizer/venues/[id]/edit` and `/maps` not. The first is the answer the
 * detail suite met in four of ten starts on 7 October 2026 (Next's HTML 404 for
 * `/api/v1/auth/login`, once for `/sign-in`); the second would have passed the
 * check this module made then, which asked for those two routes alone. Any
 * suite on the development server could meet either, on any route.
 *
 * ## The fix
 *
 * At the root, in Next: `patches/next@16.3.8.patch`, applied by pnpm on every
 * install, queues the rebuilds, so each starts after the one before has
 * published and the last reads the whole tree. `next build` and `next start`
 * never load the file. pnpm refuses the install when the patch no longer
 * applies or its version is no longer the one installed, so an upgrade of Next
 * cannot drop it silently; `src/lib/next-dev-route-rebuilds.test.js` checks the
 * installed file carries it.
 *
 * Proved the same way, with the timing made adversarial rather than loaded:
 * the watcher's directory reads and each publication of a table delayed at
 * random. Without the patch, rebuilds overlapped in every one of 8 starts and 5
 * ended stale (60, 72, 65, 65 and 72 of 73 routes; once the proxy answered
 * 404). With it, 12 of 12 ended with all 73, no rebuild began before the one
 * before had published, and no table was smaller than the one it replaced.
 *
 * ## What this module does
 *
 * Proves it on the server a suite is about to use, before any test or seed
 * does: a page, the proxy (a catch-all), and a page two dynamic segments deep
 * in a signed-in area — the three kinds of route the stale tables lost. Each is
 * told apart from Next's 404 (an HTML page): the proxy answers with the API's
 * JSON (a 401 for nobody signed in, or the proxy's own 503 when a suite leaves
 * the API down), and the organiser page redirects a visitor who is not signed
 * in. When Next does not know one, this touches the proxy's route file — its
 * time, never its contents — so the watcher reports a change and one more
 * rebuild runs, from the whole tree; then it asks again. A server that still
 * does not route them after three rebuilds fails the run here, saying which,
 * rather than as a sign-in that "could not sign in".
 *
 * `dev-routes-setup.mjs` runs it first in every config that starts `next dev`,
 * through `next-dev.mjs`, and `pnpm ci:check` refuses a config that does not.
 * It changes nothing a test asserts and nothing in the product.
 *
 * @module e2e/support/dev-routes
 */

import { utimes } from 'node:fs/promises'
import path from 'node:path'

/**
 * The proxy's route file: touched, never written, to make the watcher report a
 * change. Found from the working directory: Playwright runs from `apps/web`.
 */
const PROXY_ROUTE = path.join(process.cwd(), 'src', 'app', 'api', 'v1', '[...path]', 'route.js')

/**
 * What is asked for: a page; the proxy, a catch-all route; and a page under two
 * dynamic segments in the organiser area, which redirects a visitor who is not
 * signed in whatever the API says. No answer of a routed one is Next's HTML 404.
 */
export const PROBES = Object.freeze([
  '/sign-in',
  '/api/v1/auth/me',
  '/organizer/venues/route-check/maps',
])

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
