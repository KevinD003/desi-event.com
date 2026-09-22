/**
 * What each detail spec needs: the world, and a page already signed in.
 *
 * The sessions were established once in global setup, for the reason set out
 * there — the budget protecting `/auth/login` is ten requests a minute and is
 * deliberately not configurable, so a run that signs in eight times deserves to
 * be refused. Adopting a saved session costs no request at all.
 *
 * @module e2e/support/detail-fixtures
 */

import { readFileSync } from 'node:fs'

import { test as base } from '@playwright/test'

import { WORLD_FILE, statePath } from './detail-global-setup.mjs'

/**
 * This run's seeded ids.
 *
 * Read lazily and once: a spec that imported it at module scope would read it
 * before global setup had written it.
 *
 * @returns {object} The world.
 */
export function world() {
  return JSON.parse(readFileSync(WORLD_FILE, 'utf8'))
}

/**
 * A `test` with a page per signed-in account.
 *
 * `owner` runs the organisation and holds the seeded tickets. `beta` runs a
 * different one and is the outsider every refusal is checked against. `viewer`
 * holds `report:view` and nothing financial, and deliberately has no second
 * factor.
 */
export const test = base.extend({
  /**
   * The alpha organisation's owner.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  owner: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('owner') })

    await use(await context.newPage())
    await context.close()
  },

  /**
   * Somebody else's owner.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  outsider: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('beta') })

    await use(await context.newPage())
    await context.close()
  },

  /**
   * A VIEWER of the alpha organisation.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  viewer: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('viewer') })

    await use(await context.newPage())
    await context.close()
  },

  /**
   * A SCANNER of the alpha organisation, scoped to the alpha event only.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  scanner: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('scanner') })

    await use(await context.newPage())
    await context.close()
  },

  /**
   * A STAFF member of the alpha organisation with no door scope.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  steward: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('steward') })

    await use(await context.newPage())
    await context.close()
  },

  /**
   * The attendee holding the door tickets.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  holder: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('holder') })

    await use(await context.newPage())
    await context.close()
  },
})

export { expect } from '@playwright/test'
