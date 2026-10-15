/**
 * Global setup, first in every config that runs `next dev`: prove the routes
 * before anything uses them.
 *
 * Playwright runs it after every web server has answered its URL, so the
 * server is up; whether it routes everything it should is what
 * `settleDevRoutes` asks. Listed through `withDevRoutes` in `next-dev.mjs`, and
 * `pnpm ci:check` refuses a `next dev` config without it.
 *
 * @module e2e/support/dev-routes-setup
 */

import { settleDevRoutes } from './dev-routes.mjs'

/**
 * Settle the routes of the server the suite's pages are drawn by.
 *
 * @param {object} config The resolved Playwright config.
 * @returns {Promise<void>} Resolves once every probe is routed.
 */
export default async function devRoutesSetup(config) {
  await settleDevRoutes(config.projects[0].use.baseURL)
}
