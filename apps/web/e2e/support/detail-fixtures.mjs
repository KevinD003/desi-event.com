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
 * A page whose `goto` returns once the page has arrived, not once it loaded.
 *
 * Every signed-in area streams behind a `loading.jsx` boundary, and React
 * reveals the finished page after the document's `load` event — so a read
 * taken straight after `goto` can see "Loading your tickets…" instead of the
 * tickets. Three specs did exactly that once the boundaries were added, and
 * passed or failed on timing. Every page has one `h1` and the loading fallback
 * has none, so an `h1` inside `main` is the sign the page itself is there.
 *
 * Only for HTML: a `goto` to the sitemap or the manifest has no heading to wait
 * for and returns as Playwright's does.
 *
 * @param {object} page A Playwright page.
 * @returns {object} The same page, its `goto` waiting for arrival.
 */
export function arriving(page) {
  const goto = page.goto.bind(page)

  page.goto = async (url, options) => {
    const response = await goto(url, options)
    const type = response?.headers()['content-type'] ?? ''

    if (type.includes('text/html')) {
      await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 15_000 })
    }

    return response
  }

  return page
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

    await use(arriving(await context.newPage()))
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

    await use(arriving(await context.newPage()))
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

    await use(arriving(await context.newPage()))
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

    await use(arriving(await context.newPage()))
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

    await use(arriving(await context.newPage()))
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

    await use(arriving(await context.newPage()))
    await context.close()
  },

  /**
   * The seed's platform reader, a SUPER_ADMIN with no membership.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  platform: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath('platform') })

    await use(arriving(await context.newPage()))
    await context.close()
  },

  /**
   * Nobody: a window with no session at all.
   *
   * @param {object} fixtures Playwright fixtures.
   * @param {object} fixtures.browser The browser under test.
   * @param {Function} use Hands the page to the test.
   * @returns {Promise<void>} Resolves when the test is done.
   */
  visitor: async ({ browser }, use) => {
    const context = await browser.newContext()

    await use(arriving(await context.newPage()))
    await context.close()
  },
})

export { expect } from '@playwright/test'
