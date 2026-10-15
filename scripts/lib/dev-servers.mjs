/**
 * Which Playwright configs start `next dev`, and whether each proves its routes
 * before a test runs.
 *
 * `next dev` 16.3.8 could start with a stale table of routes: its watcher ran
 * one rebuild of the table per burst of file events, unawaited, and an early
 * rebuild that finished last left whole sets of routes answering Next's 404
 * (`apps/web/e2e/support/dev-routes.mjs` has the proof; the fix is
 * `patches/next@16.3.8.patch`). The fault is in Next, not in a config, so every
 * config that starts the development server is exposed to it — yet only one of
 * the six had a guard, and the routes the others' specs drive were among those
 * a stale table lost.
 *
 * So every config that starts `next dev` must start it through
 * `apps/web/e2e/support/next-dev.mjs`, whose entries carry a mark, and must run
 * that module's route proof, `dev-routes-setup.mjs`, as its first global setup.
 * A config that starts `next dev` by hand, or forgets the proof, or runs it
 * after a setup that already needs the routes, is refused before any browser
 * starts.
 *
 * Like `./spec-collection.mjs`, nothing here reads a file or loads a config:
 * the checker hands in loaded configs, so the rule is tested with plain
 * objects. And like it, a server command this cannot classify is not assumed
 * to be harmless: a command that reaches the development server through a
 * package script (`pnpm dev`, `npm run dev`) counts as `next dev`.
 *
 * @module scripts/lib/dev-servers
 */

import path from 'node:path'

/** The mark `nextDevServer` puts on the entries it builds. */
export const NEXT_DEV_SERVER = Symbol.for('desi-event.e2e.next-dev-server')

/** The route proof, relative to the web package. */
export const DEV_ROUTES_SETUP = 'e2e/support/dev-routes-setup.mjs'

/** The helper every `next dev` entry is built by, for the messages. */
const HELPER = 'e2e/support/next-dev.mjs'

/**
 * Whether a web server command starts the Next development server, directly
 * or through a package script.
 *
 * @param {unknown} command The entry's `command`.
 * @returns {boolean} True for `next dev`, `npx next dev`, `pnpm dev`, `npm run dev`…
 */
export function startsNextDev(command) {
  if (typeof command !== 'string') return false

  return (
    /\bnext\s+dev(?=\s|$)/u.test(command) ||
    /\b(?:pnpm|npm|yarn)\b[^;&|]*?\s(?:run\s+)?dev(?=\s|$)/u.test(command)
  )
}

/**
 * A config's web server entries, as a list.
 *
 * @param {object} config A loaded Playwright config.
 * @returns {object[]} Its `webServer` entries.
 */
function webServersOf(config) {
  const { webServer } = config ?? {}

  if (webServer === undefined || webServer === null) return []

  return Array.isArray(webServer) ? webServer : [webServer]
}

/**
 * A config's global setup files, as a list.
 *
 * @param {object} config A loaded Playwright config.
 * @returns {unknown[]} Its `globalSetup` entries.
 */
function globalSetupsOf(config) {
  const { globalSetup } = config ?? {}

  if (globalSetup === undefined || globalSetup === null) return []

  return Array.isArray(globalSetup) ? globalSetup : [globalSetup]
}

/**
 * Judge every config that starts `next dev`.
 *
 * @param {object} input What to judge.
 * @param {Array<{file: string, dir: string, config: object}>} input.configs Every loaded Playwright config: its file name, the directory it sits in, and its default export.
 * @param {string} input.webDirectory The web package, relative to the repository, for messages.
 * @param {function(string): boolean} input.exists Whether a file exists, by absolute path.
 * @returns {{problems: Array<{where: string, what: string}>, devConfigs: string[]}} What is wrong, and which configs start `next dev`.
 */
export function judgeDevServers({ configs, webDirectory, exists }) {
  const problems = []
  const devConfigs = []

  for (const { file, dir, config } of configs) {
    const where = `${webDirectory}/${file}`
    const devServers = webServersOf(config).filter((server) => startsNextDev(server?.command))

    if (devServers.length === 0) continue

    devConfigs.push(file)

    for (const server of devServers) {
      if (server[NEXT_DEV_SERVER] !== true) {
        problems.push({
          where,
          what:
            `starts \`${server.command}\` by hand — build the entry with nextDevServer() from ` +
            `${HELPER}, so the development server is started one way and its routes are proved ` +
            'before any test',
        })
      }
    }

    const setups = globalSetupsOf(config)
    const proof = path.resolve(dir, DEV_ROUTES_SETUP)
    const at = setups.findIndex(
      (setup) => typeof setup === 'string' && path.resolve(dir, setup) === proof,
    )

    if (at === -1) {
      problems.push({
        where,
        what:
          `starts next dev without ${DEV_ROUTES_SETUP} in its globalSetup — list it with ` +
          `withDevRoutes() from ${HELPER}, or a stale route table reaches the tests as 404s`,
      })

      continue
    }

    if (at !== 0) {
      problems.push({
        where,
        what:
          `runs ${DEV_ROUTES_SETUP} after another global setup, which may already need the ` +
          'routes it proves — withDevRoutes() lists it first',
      })
    }

    if (!exists(proof)) {
      problems.push({ where, what: `names ${DEV_ROUTES_SETUP}, which does not exist` })
    }
  }

  return { problems, devConfigs }
}
