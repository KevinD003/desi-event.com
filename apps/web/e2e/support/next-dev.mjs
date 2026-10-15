/**
 * The one way a browser suite starts `next dev`.
 *
 * Every Playwright config that runs the development server builds its web
 * server entry with {@link nextDevServer} and lists {@link DEV_ROUTES_SETUP}
 * first among its global setups, so the routes are proved before any test or
 * seed asks for one. `pnpm ci:check` refuses a config that starts `next dev`
 * any other way (`scripts/lib/dev-servers.mjs`): the startup fault this guards
 * against is in Next itself, not in any one config, and the one config that
 * once had a guard was the only one that did.
 *
 * Why the routes need proving at all, and what fixes the fault at its root, is
 * in `dev-routes.mjs`.
 *
 * Nothing is imported here but Node's own modules, so `ci:check` can load every
 * config without loading Playwright's runner.
 *
 * @module e2e/support/next-dev
 */

/**
 * The mark on a web server entry this module built, for `ci:check` to read.
 * A registered symbol, so the checker can name it without importing this file;
 * not enumerable, so Playwright never sees it.
 */
export const NEXT_DEV_SERVER = Symbol.for('desi-event.e2e.next-dev-server')

/**
 * The global setup that proves the routes, relative to `apps/web`, where every
 * config lives and against which Playwright resolves `globalSetup`.
 */
export const DEV_ROUTES_SETUP = './e2e/support/dev-routes-setup.mjs'

/**
 * How long `next dev` is given to answer its first page. Compiling it on a
 * two-core runner beside the API takes most of a minute.
 */
const START_TIMEOUT_MS = 180_000

/**
 * The web server entry for `next dev` on a port.
 *
 * @param {object} options Options.
 * @param {number} options.port The port; the server listens on 127.0.0.1.
 * @param {Record<string, string>} [options.env] Variables for the server, such as the API it talks to.
 * @param {boolean} [options.reuseExistingServer] Whether a server already listening there is used instead.
 * @returns {object} The entry, for a config's `webServer`.
 */
export function nextDevServer({ port, env, reuseExistingServer = false }) {
  const server = {
    command: `npx next dev --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer,
    timeout: START_TIMEOUT_MS,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(env ? { env } : {}),
  }

  Object.defineProperty(server, NEXT_DEV_SERVER, { value: true })

  return server
}

/**
 * A config's global setups: the route proof first, then its own.
 *
 * @param {...string} setups The config's own global setup files, in order.
 * @returns {string[]} The list for `globalSetup`.
 */
export function withDevRoutes(...setups) {
  return [DEV_ROUTES_SETUP, ...setups]
}
